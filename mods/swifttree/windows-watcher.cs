using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

internal sealed class SwiftTreeWindowsWatcher : IDisposable
{
    private const int MaxPaths = 1024;
    private const int DisconnectCheckMilliseconds = 250;
    private const int KeepAliveMilliseconds = 10000;
    private readonly string root;
    private readonly object gate = new object();
    private readonly HashSet<string> pending = new HashSet<string>(StringComparer.Ordinal);
    private readonly AutoResetEvent changed = new AutoResetEvent(false);
    private readonly FileSystemWatcher watcher;
    private bool failed;
    private bool disposed;

    private SwiftTreeWindowsWatcher(string root)
    {
        this.root = root;
        watcher = new FileSystemWatcher(root)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName,
            InternalBufferSize = 16384,
        };
        watcher.Created += (sender, item) => Add(item.FullPath);
        watcher.Deleted += (sender, item) => Add(item.FullPath);
        watcher.Renamed += (sender, item) => Add(item.OldFullPath, item.FullPath);
        watcher.Error += (sender, item) => Lost(item.GetException());
        watcher.EnableRaisingEvents = true;
    }

    public static int Run(string root, string endpoint)
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        try
        {
            using (var watch = new SwiftTreeWindowsWatcher(root))
            {
                listener.Start(1);
                var token = new byte[16];
                using (var random = RandomNumberGenerator.Create()) random.GetBytes(token);
                var password = Convert.ToBase64String(token);
                var port = ((IPEndPoint)listener.LocalEndpoint).Port;
                File.WriteAllText(endpoint + ".tmp",
                    SwiftTreeWindowsDirectory.Serialize(new { port = port, token = password }));
                File.Move(endpoint + ".tmp", endpoint);
                SwiftTreeWindowsDirectory.Trace("watch", root, "ready");

                var deadline = Stopwatch.StartNew();
                while (!listener.Pending())
                {
                    if (deadline.ElapsedMilliseconds >= 5000) return 2;
                    Thread.Sleep(20);
                }
                using (var client = listener.AcceptTcpClient())
                {
                    client.ReceiveTimeout = 2000;
                    client.SendTimeout = 2000;
                    client.NoDelay = true;
                    listener.Stop();
                    var stream = client.GetStream();
                    if (!Authenticate(stream, password)) return 2;
                    watch.Deliver(client, stream);
                }
            }
            return 0;
        }
        catch (IOException) { return 1; }
        catch (UnauthorizedAccessException) { return 1; }
        catch (ArgumentException) { return 1; }
        catch (SocketException) { return 1; }
        finally
        {
            listener.Stop();
        }
    }

    private static bool Authenticate(NetworkStream stream, string password)
    {
        var received = new byte[password.Length];
        int offset = 0;
        while (offset < received.Length)
        {
            int count = stream.Read(received, offset, received.Length - offset);
            if (count == 0) return false;
            offset += count;
        }
        return Encoding.ASCII.GetString(received) == password;
    }

    private void Add(params string[] paths)
    {
        lock (gate)
        {
            if (disposed || pending.Contains(root)) return;
            foreach (var path in paths) pending.Add(path);
            if (pending.Count > MaxPaths)
            {
                pending.Clear();
                pending.Add(root);
            }
            changed.Set();
        }
    }

    private void Lost(Exception error)
    {
        lock (gate)
        {
            if (disposed) return;
            pending.Clear();
            pending.Add(root);
            failed |= !(error is InternalBufferOverflowException);
            changed.Set();
        }
        SwiftTreeWindowsDirectory.Trace("watch", root, error is InternalBufferOverflowException ? "overflow" : "error");
    }

    private void Deliver(TcpClient client, NetworkStream stream)
    {
        var lastMessage = Stopwatch.StartNew();
        while (!client.Client.Poll(0, SelectMode.SelectRead) || client.Available != 0)
        {
            if (!changed.WaitOne(DisconnectCheckMilliseconds))
            {
                if (lastMessage.ElapsedMilliseconds >= KeepAliveMilliseconds)
                {
                    // Keep Herdr's pending socket read alive without invalidating a listing.
                    stream.WriteByte((byte)'\n');
                    lastMessage.Restart();
                }
                continue;
            }
            Thread.Sleep(35);
            string[] paths;
            bool end;
            lock (gate)
            {
                paths = pending.ToArray();
                pending.Clear();
                end = failed;
            }
            if (paths.Length != 0)
            {
                var message = WireMessage(paths);
                stream.Write(message, 0, message.Length);
                lastMessage.Restart();
            }
            if (end) return;
        }
    }

    private static byte[] WireMessage(string[] paths)
    {
        var json = SwiftTreeWindowsDirectory.Serialize(paths);
        var ascii = new StringBuilder(json.Length + 1);
        foreach (char character in json)
        {
            if (character < 128) ascii.Append(character);
            else ascii.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
        }
        return Encoding.ASCII.GetBytes(ascii.Append('\n').ToString());
    }

    public void Dispose()
    {
        watcher.Dispose();
        lock (gate)
        {
            disposed = true;
            changed.Dispose();
        }
    }
}
