using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class SwiftTreePreviewLauncher
{
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr ExitStatus, Peb, AffinityMask, BasePriority, ProcessId, ParentId;
    }

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr process, int informationClass,
        out ProcessInformation information, int informationLength, out int returnLength);

    public static int WarmUp(string home) { return Start(home, null); }

    public static int Connect(string endpoint)
    {
        string home = Directory.GetParent(Path.GetDirectoryName(endpoint)).FullName;
        return Start(home, endpoint);
    }

    private static int Start(string home, string endpoint)
    {
        FileStream installation;
        try
        {
            installation = File.Open(Path.Combine(home, ".swifttree-install.lock"), FileMode.OpenOrCreate,
                                     FileAccess.ReadWrite, FileShare.ReadWrite);
        }
        catch (IOException error)
        {
            int reason = error.HResult & 0xffff;
            if (reason == 32 || reason == 33) return 3;
            throw;
        }
        // The installer takes an exclusive lock before stopping the previous host and swapping the mod.
        using (installation) return StartWithInstallationLease(home, endpoint);
    }

    private static int StartWithInstallationLease(string home, string endpoint)
    {
        ProcessInformation info;
        int length;
        using (var caller = Process.GetCurrentProcess())
            if (NtQueryInformationProcess(caller.Handle, 0, out info,
                Marshal.SizeOf(typeof(ProcessInformation)), out length) != 0) return 1;

        using (var owner = Process.GetProcessById(info.ParentId.ToInt32()))
        {
            if (!String.Equals(owner.ProcessName, "herdr-app", StringComparison.OrdinalIgnoreCase)) return 1;
            string identity = owner.Id.ToString(CultureInfo.InvariantCulture) + "-"
                + owner.StartTime.ToFileTimeUtc().ToString(CultureInfo.InvariantCulture);
            string registry = Path.Combine(home, ".swifttree-preview-" + identity + ".json");
            string native = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "preview-host");
            string build = File.ReadAllText(Path.Combine(native, "build-id"));
            using (var launchLock = new Mutex(false, @"Local\SwiftTree-preview-" + identity))
            {
                try { if (!launchLock.WaitOne(7000)) return 1; }
                catch (AbandonedMutexException) { }
                try
                {
                    var previous = SwiftTreePreviewEndpoint.Read(registry);
                    using (var running = previous == null ? null : previous.OpenHost())
                    {
                        if (running != null && previous.build != build && !previous.Stop(running)) return 1;
                        if ((running == null || running.HasExited) && !Launch(owner.Id, native, registry, build)) return 1;
                    }
                    if (endpoint != null) File.Copy(registry, endpoint);
                }
                finally { launchLock.ReleaseMutex(); }
            }
        }
        return 0;
    }

    private static bool Launch(int owner, string native, string registry, string build)
    {
        File.Delete(registry);
        var options = new ProcessStartInfo
        {
            FileName = Path.Combine(native, "swifttree-preview.exe"),
            Arguments = owner.ToString(CultureInfo.InvariantCulture) + " "
                + Convert.ToBase64String(Encoding.UTF8.GetBytes(registry)) + " " + build,
            // Keep the long-lived host from inheriting Herdr exec's output pipes.
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        using (var host = Process.Start(options))
        {
            var timer = Stopwatch.StartNew();
            while (!File.Exists(registry) && !host.HasExited && timer.ElapsedMilliseconds < 5000)
                Thread.Sleep(20);
            if (File.Exists(registry)) return true;
            if (!host.HasExited)
            {
                host.Kill();
                host.WaitForExit();
            }
            return false;
        }
    }

    public static int StopInstalled(string home)
    {
        string installed = Path.Combine(home, "mods", "swifttree", "preview-host", "swifttree-preview.exe");
        foreach (string file in Directory.EnumerateFiles(home, ".swifttree-preview-*.json"))
        {
            var endpoint = SwiftTreePreviewEndpoint.Read(file);
            using (var host = endpoint == null ? null : endpoint.OpenHost())
            {
                if (host != null && String.Equals(host.MainModule.FileName, installed, StringComparison.OrdinalIgnoreCase)
                    && !endpoint.Stop(host)) return 1;
            }
        }
        return 0;
    }
}
