using System;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

internal static class SwiftTreeWindowsDirectoryServer
{
    public static int Run(string corePid, string endpoint)
    {
        return SwiftTreeWindowsLocalService.Run(endpoint, null, (client, stream) =>
        {
            using (var core = new SwiftTreeWindowsCoreBridge(corePid))
                Serve(client, stream, core);
        });
    }

    private static void Serve(TcpClient client, NetworkStream stream, SwiftTreeWindowsCoreBridge core)
    {
        var writeGate = new object();
        Action<byte[]> send = bytes =>
        {
            try
            {
                lock (writeGate) stream.Write(bytes, 0, bytes.Length);
            }
            catch (IOException) { client.Close(); }
            catch (ObjectDisposedException) { }
        };
        using (var reader = new StreamReader(stream, new UTF8Encoding(false, true)))
        using (var heartbeat = new Timer(_ => send(new[] { (byte)'\n' }), null, 10000, 10000))
        {
            string line;
            while ((line = reader.ReadLine()) != null)
            {
                var request = SwiftTreeWindowsDirectory.Deserialize<Request>(line);
                if (request == null || request.id <= 0 || String.IsNullOrEmpty(request.folder)) return;
                Task.Run(() =>
                {
                    object listing = null;
                    try
                    {
                        listing = request.machine == null
                            ? ReadLocal(request)
                            : ReadRemote(request, core);
                    }
                    catch (Exception) { }
                    send(SwiftTreeWindowsLocalService.WireMessage(new { id = request.id, listing = listing }));
                });
            }
        }
    }

    private static object ReadRemote(Request request, SwiftTreeWindowsCoreBridge core)
    {
        var result = core.Execute(request.machine,
            new[] { "sh", "-c", request.script, "swifttree", request.folder, request.ancestors ?? "" }, 30);
        if (result == null || result.timed_out || result.truncated) return null;
        if (result.code == 43) return new { status = "denied" };
        if (result.code == 44) return new { status = "missing" };
        if (result.code == 45) return new { status = "cycle" };
        if (result.code != 0 || result.stdout == null) return null;
        return SwiftTreeWindowsDirectory.DecodeLinuxListing(result.stdout);
    }

    private static object ReadLocal(Request request)
    {
        try
        {
            return SwiftTreeWindowsDirectory.ReadLocalListing(request.folder, request.reason, request.ancestors);
        }
        catch (UnauthorizedAccessException) { return new { status = "denied" }; }
        catch (DirectoryNotFoundException) { return new { status = "missing" }; }
        catch (FileNotFoundException) { return new { status = "missing" }; }
    }

    private sealed class Request
    {
        public int id { get; set; }
        public string folder { get; set; }
        public string reason { get; set; }
        public string machine { get; set; }
        public string script { get; set; }
        public string ancestors { get; set; }
    }
}
