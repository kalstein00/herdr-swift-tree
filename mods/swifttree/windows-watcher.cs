using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Sockets;
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
        try
        {
            using (var watch = new SwiftTreeWindowsWatcher(root))
            {
                return SwiftTreeWindowsLocalService.Run(endpoint,
                    () => SwiftTreeWindowsDirectory.Trace("watch", root, "ready"), watch.Deliver);
            }
        }
        catch (IOException) { return 1; }
        catch (UnauthorizedAccessException) { return 1; }
        catch (ArgumentException) { return 1; }
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
                var message = SwiftTreeWindowsLocalService.WireMessage(paths);
                stream.Write(message, 0, message.Length);
                lastMessage.Restart();
            }
            if (end) return;
        }
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
