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
                            : core.List(request.machine, request.script, request.folder);
                    }
                    catch (Exception) { }
                    send(SwiftTreeWindowsLocalService.WireMessage(new { id = request.id, listing = listing }));
                });
            }
        }
    }

    private static object ReadLocal(Request request)
    {
        SwiftTreeWindowsDirectory.Trace("list", request.folder, request.reason);
        try
        {
            return new { status = "ready", entries = SwiftTreeWindowsDirectory.ReadDirectory(request.folder) };
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
    }
}
