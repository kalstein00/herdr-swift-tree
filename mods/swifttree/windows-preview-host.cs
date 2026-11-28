using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class SwiftTreePreviewHost : Form
{
    private const string WebHost = "swifttree-preview.example";
    private const string PageAddress = "https://" + WebHost + "/index.html";
    private readonly Process ownerProcess;
    private readonly string registry;
    private readonly string build;
    private readonly TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
    private readonly string tracePath = Environment.GetEnvironmentVariable("SWIFTTREE_PREVIEW_TRACE");
    private readonly object traceGate = new object();
    private readonly Dictionary<string, SwiftTreeWindowsCoreBridge> cores = new Dictionary<string, SwiftTreeWindowsCoreBridge>();
    private readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill, Visible = false };
    private readonly Label status = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter };
    private readonly Timer ownerTimer = new Timer { Interval = 250 };
    private IntPtr ownerWindow;
    private Request opened;
    private int generation;
    private bool ready;
    private bool unavailable;
    private bool exiting;

    private SwiftTreePreviewHost(Process owner, string registry, string build)
    {
        ownerProcess = owner;
        this.registry = registry;
        this.build = build;
        Text = "SwiftTree expanded preview";
        StartPosition = FormStartPosition.Manual;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        KeyPreview = true;
        BackColor = Color.FromArgb(25, 28, 34);
        status.ForeColor = Color.White;
        web.DefaultBackgroundColor = BackColor;
        Controls.Add(web);
        Controls.Add(status);
        ownerTimer.Tick += (sender, args) => { if (ownerProcess.HasExited) ExitHost(); };
        web.KeyDown += (sender, args) =>
        {
            if (args.KeyCode != Keys.Escape) return;
            args.Handled = true;
            int revision = generation;
            BeginInvoke(new Action(() => { if (revision == generation) HidePreview(); }));
        };
    }

    [STAThread]
    public static void Main(string[] args)
    {
        int ownerId;
        if (args.Length != 3 || !Int32.TryParse(args[0], out ownerId)) return;
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string registry = Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));
        using (var owner = Process.GetProcessById(ownerId))
        using (var host = new SwiftTreePreviewHost(owner, registry, args[2]))
        {
            host.CreateHandle();
            host.BeginInvoke(new Action(host.Start));
            Application.Run();
        }
    }

    private void Start()
    {
        ownerTimer.Start();
        Trace("prewarm/start");
        Task.Run(() =>
        {
            try { Listen(); }
            catch (Exception error) { Trace("socket/end/" + error.GetType().Name); }
            finally { OnGui(ExitHost); }
        });
        WarmWebView();
    }

    private async void WarmWebView()
    {
        try
        {
            string appHome = Path.GetDirectoryName(registry);
            string profile = Path.Combine(appHome, ".swifttree-preview-webview");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            if (exiting) return;
            await web.EnsureCoreWebView2Async(environment);
            if (exiting) return;

            var core = web.CoreWebView2;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultScriptDialogsEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.NavigationStarting += (s, e) => e.Cancel = e.Uri != PageAddress;
            core.NewWindowRequested += (s, e) => e.Handled = true;
            core.DownloadStarting += (s, e) => e.Cancel = true;
            core.PermissionRequested += (s, e) => e.State = CoreWebView2PermissionState.Deny;
            core.NavigationCompleted += (s, e) => { if (!e.IsSuccess) WebViewFailed(); };
            core.ProcessFailed += (s, e) => WebViewFailed();
            core.SetVirtualHostNameToFolderMapping(WebHost,
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "site"), CoreWebView2HostResourceAccessKind.Deny);
            core.WebMessageReceived += WebMessageReceived;
            core.Navigate(PageAddress);
        }
        catch (Exception) { if (!exiting) WebViewFailed(); }
    }

    private void Listen()
    {
        string staged = registry + ".tmp";
        var endpoint = new SwiftTreePreviewEndpoint { token = SwiftTreeWindowsLocalService.NewPassword(), build = build };
        using (var host = Process.GetCurrentProcess())
        {
            endpoint.hostPid = host.Id;
            endpoint.hostStarted = host.StartTime.ToFileTimeUtc();
        }
        using (var stop = new System.Threading.EventWaitHandle(false, System.Threading.EventResetMode.AutoReset, endpoint.StopEventName))
        {
            var registration = System.Threading.ThreadPool.RegisterWaitForSingleObject(stop,
                (_, timedOut) => OnGui(ExitHost), null, -1, true);
            try { ListenForFiles(staged, endpoint); }
            finally { registration.Unregister(null); }
        }
    }

    private void ListenForFiles(string staged, SwiftTreePreviewEndpoint endpoint)
    {
        try
        {
            listener.Start(4);
            endpoint.port = ((IPEndPoint)listener.LocalEndpoint).Port;
            File.WriteAllText(staged, SwiftTreeWindowsLocalService.Json(endpoint));
            File.Move(staged, registry);
            Trace("socket/listen");
            while (!ownerProcess.HasExited)
            {
                using (var client = listener.AcceptTcpClient())
                {
                    client.NoDelay = true;
                    client.ReceiveTimeout = 2000;
                    client.SendTimeout = 2000;
                    try
                    {
                        var stream = client.GetStream();
                        if (!SwiftTreeWindowsLocalService.Authenticate(stream, endpoint.token)) continue;
                        client.ReceiveTimeout = 0;
                        Serve(client, stream);
                    }
                    catch (IOException) { }
                    catch (ArgumentException) { }
                    finally { OnGui(HidePreview); }
                }
            }
        }
        finally
        {
            File.Delete(staged);
            File.Delete(registry);
        }
    }

    private void WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (args.Source != PageAddress) return;
        string message;
        try { message = args.TryGetWebMessageAsString(); }
        catch (ArgumentException) { return; }
        var revision = generation.ToString(CultureInfo.InvariantCulture);
        if (message == "close:" + revision && Visible) HidePreview();
        if (message == "begun:" + revision && Visible && opened != null)
            RevealDocument(opened, generation);
        if (message != "ready" || ready || unavailable) return;
        ready = true;
        Trace("prewarm/ready/" + web.CoreWebView2.BrowserProcessId);
        if (opened != null) StartDocument(opened, generation);
    }

    private async void RevealDocument(Request request, int revision)
    {
        try
        {
            await Task.Run(() => VerifySource(request));
            if (revision != generation) return;
            status.Visible = false;
            web.Visible = true;
            web.Focus();
            Trace("document/begun");
        }
        catch (Exception error) { DocumentFailed(request, revision, error); }
    }

    private void WebViewFailed()
    {
        unavailable = true;
        ready = false;
        ++generation;
        Trace("prewarm/unavailable");
        ShowStatus("Could not start the WebView2 preview.");
    }

    private void Serve(TcpClient client, NetworkStream stream)
    {
        Trace("socket/connected");
        var writeGate = new object();
        var json = new JavaScriptSerializer();
        Action<byte[]> send = reply =>
        {
            try { lock (writeGate) stream.Write(reply, 0, reply.Length); }
            catch (IOException) { client.Close(); }
            catch (ObjectDisposedException) { }
        };
        using (var reader = new StreamReader(stream, new UTF8Encoding(false, true)))
        using (var heartbeat = new System.Threading.Timer(_ => send(new[] { (byte)'\n' }), null, 10000, 10000))
        {
            string line;
            while ((line = reader.ReadLine()) != null)
            {
                var command = json.Deserialize<Request>(line);
                if (command == null) return;
                Trace("request/" + command.action);
                switch (command.action)
                {
                    case "read":
                        if (command.id <= 0 || String.IsNullOrEmpty(command.path)) return;
                        Task.Run(() => ReadPrefix(command, send));
                        break;
                    case "open":
                        if (command.id <= 0 || String.IsNullOrEmpty(command.path) || String.IsNullOrEmpty(command.version)
                            || String.IsNullOrEmpty(command.prefixHash)) return;
                        OnGui(() =>
                        {
                            bool displayed = OpenPreview(command);
                            Task.Run(() => send(SwiftTreeWindowsLocalService.WireMessage(new { id = command.id, result = displayed })));
                        });
                        break;
                    case "hide": OnGui(HidePreview); break;
                    default: return;
                }
            }
        }
    }

    private void ReadPrefix(Request command, Action<byte[]> send)
    {
        object result = null;
        try
        {
            using (var file = OpenFile(command, true))
            {
                string text = file.ReadRange(SwiftTreePreviewText.PrefixBytes);
                if (command.machine == null) SwiftTreePreviewFile.VerifyPath(command.path, file.Version);
                result = new { text = text, partial = !file.AtEnd, version = file.Version,
                               prefixHash = SwiftTreePreviewText.Fingerprint(text) };
            }
        }
        catch (Exception error) { Trace("prefix/unavailable/" + error.GetType().Name); }
        send(SwiftTreeWindowsLocalService.WireMessage(new { id = command.id, result = result }));
    }

    private bool OpenPreview(Request request)
    {
        if (ownerProcess.HasExited || exiting) return false;
        bool needsShow = !Visible;
        if (needsShow)
        {
            uint processId;
            var foreground = GetForegroundWindow();
            GetWindowThreadProcessId(foreground, out processId);
            ownerProcess.Refresh();
            var window = processId == ownerProcess.Id ? foreground : ownerProcess.MainWindowHandle;
            Rectangle bounds;
            if (window == IntPtr.Zero || !GetBounds(window, out bounds)) return false;
            Bounds = bounds;
            ownerWindow = window;
        }
        opened = request;
        ++generation;
        Trace(ready ? "show/ready" : "show/warming");
        ShowStatus(unavailable ? "Could not start the WebView2 preview." : "Loading preview…");
        Text = "SwiftTree expanded preview — " + request.name;
        if (needsShow)
        {
            Show(new OwnerHandle(ownerWindow));
            EnableWindow(ownerWindow, false);
            Activate();
        }
        if (ready) StartDocument(request, generation);
        return true;
    }

    private async void StartDocument(Request request, int revision)
    {
        try
        {
            using (var file = await Task.Run(() => OpenFile(request, false)))
            {
                if (revision != generation) return;
                if (file.Version != request.version) throw new IOException("Preview file changed.");
                string text = await Task.Run(() =>
                {
                    string prefix = file.ReadRange(SwiftTreePreviewText.PrefixBytes);
                    if (SwiftTreePreviewText.Fingerprint(prefix) != request.prefixHash)
                        throw new IOException("Preview file changed.");
                    if (request.machine == null) SwiftTreePreviewFile.VerifyPath(request.path, file.Version);
                    return prefix;
                });
                if (revision != generation) return;
                Post(new { action = "begin", id = revision, name = request.name, text = text });
                Trace("document/prefix");
                int rangeBytes = request.machine == null ? SwiftTreePreviewText.RangeBytes : SwiftTreeLinuxPreviewFile.RangeBytes;
                while (!file.AtEnd)
                {
                    string part = await Task.Run(() => file.ReadRange(rangeBytes));
                    if (revision != generation) return;
                    Post(new { action = "append", id = revision, text = part });
                }
                await Task.Run(() => file.VerifyCompletion(request.path));
                if (revision == generation)
                {
                    Post(new { action = "complete", id = revision });
                    Trace("document/complete");
                }
            }
        }
        catch (Exception error) { DocumentFailed(request, revision, error); }
    }

    private ISwiftTreePreviewFile OpenFile(Request request, bool prefixOnly)
    {
        if (request.machine == null)
            return new SwiftTreePreviewFile(request.path, prefixOnly ? SwiftTreePreviewText.PrefixBytes : Int64.MaxValue);
        return new SwiftTreeLinuxPreviewFile(CoreFor(request.corePid), request.machine, request.path, request.version, prefixOnly);
    }

    private void VerifySource(Request request)
    {
        if (request.machine == null) SwiftTreePreviewFile.VerifyPath(request.path, request.version);
        else SwiftTreeLinuxPreviewFile.VerifyPath(CoreFor(request.corePid), request.machine, request.path, request.version);
    }

    private SwiftTreeWindowsCoreBridge CoreFor(string processId)
    {
        lock (cores)
        {
            string key = processId ?? "";
            SwiftTreeWindowsCoreBridge core;
            if (cores.TryGetValue(key, out core)) return core;
            core = new SwiftTreeWindowsCoreBridge(key);
            cores.Add(key, core);
            return core;
        }
    }

    private void DocumentFailed(Request request, int revision, Exception error)
    {
        if (revision != generation) return;
        ++generation;
        string message = request.machine == null ? "Preview unavailable. Reopen the file to try again."
            : "Could not read the remote file. Reopen it to try again.";
        if (error is SwiftTreeLinuxPreviewException) message = error.Message;
        ShowStatus(message);
        if (ready) Post(new { action = "clear", id = generation });
    }

    private void Post(object message)
    {
        web.CoreWebView2.PostWebMessageAsJson(SwiftTreeWindowsLocalService.Json(message));
    }

    private void ShowStatus(string message)
    {
        web.Visible = false;
        status.Text = message;
        status.Visible = true;
    }

    private void HidePreview()
    {
        if (!Visible) return;
        Trace("hide");
        ++generation;
        opened = null;
        web.Visible = false;
        if (ownerWindow != IntPtr.Zero) EnableWindow(ownerWindow, true);
        Hide();
        if (ownerWindow != IntPtr.Zero) SetForegroundWindow(ownerWindow);
        ownerWindow = IntPtr.Zero;
        if (ready) Post(new { action = "clear", id = generation });
    }

    protected override void OnFormClosing(FormClosingEventArgs args)
    {
        if (!exiting && args.CloseReason == CloseReason.UserClosing)
        {
            args.Cancel = true;
            HidePreview();
        }
        base.OnFormClosing(args);
    }

    protected override bool ProcessCmdKey(ref Message message, Keys keys)
    {
        if (keys != Keys.Escape) return base.ProcessCmdKey(ref message, keys);
        HidePreview();
        return true;
    }

    private void ExitHost()
    {
        if (exiting) return;
        exiting = true;
        Trace("exit");
        ready = false;
        HidePreview();
        listener.Stop();
        // The registry must disappear even while a Files client is connected.
        try { File.Delete(registry); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        ownerTimer.Dispose();
        lock (cores)
            foreach (var core in cores.Values) core.Dispose();
        Application.ExitThread();
    }

    private void OnGui(Action action)
    {
        try { BeginInvoke(action); }
        catch (InvalidOperationException) { }
    }

    private void Trace(string action)
    {
        if (String.IsNullOrEmpty(tracePath)) return;
        string line = Stopwatch.GetTimestamp().ToString(CultureInfo.InvariantCulture) + " "
            + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture) + " " + action + Environment.NewLine;
        try { lock (traceGate) File.AppendAllText(tracePath, line); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static bool GetBounds(IntPtr window, out Rectangle bounds)
    {
        WindowRect rect;
        bounds = Rectangle.Empty;
        if (!GetWindowRect(window, out rect)) return false;
        int width = (rect.Right - rect.Left) * 4 / 5;
        int height = (rect.Bottom - rect.Top) * 78 / 100;
        bounds = new Rectangle((rect.Left + rect.Right - width) / 2, (rect.Top + rect.Bottom - height) / 2,
                               width, height);
        return width > 0 && height > 0;
    }

    private sealed class OwnerHandle : IWin32Window
    {
        public OwnerHandle(IntPtr window) { Handle = window; }
        public IntPtr Handle { get; private set; }
    }

    private sealed class Request
    {
        public string action { get; set; }
        public int id { get; set; }
        public string path { get; set; }
        public string name { get; set; }
        public string version { get; set; }
        public string prefixHash { get; set; }
        public string machine { get; set; }
        public string corePid { get; set; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WindowRect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out WindowRect rect);
    [DllImport("user32.dll")] private static extern bool EnableWindow(IntPtr window, bool enabled);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
}
