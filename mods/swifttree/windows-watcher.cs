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
    private const int LinkCheckMilliseconds = 100;
    private const int KeepAliveMilliseconds = 10000;
    private readonly string root;
    private readonly object gate = new object();
    private readonly HashSet<string> pending = new HashSet<string>(StringComparer.Ordinal);
    private readonly AutoResetEvent changed = new AutoResetEvent(false);
    private readonly HashSet<string> ancestors;
    private FileSystemWatcher watcher;
    private string linkIdentity;
    private bool failed;
    private bool disposed;

    private SwiftTreeWindowsWatcher(string root, string ancestors)
    {
        this.root = root;
        if (ancestors == null)
        {
            StartWatcher();
        }
        else
        {
            this.ancestors = new HashSet<string>(ancestors.Split(','), StringComparer.Ordinal);
            RefreshLinkWatcher(false);
        }
    }

    private void StartWatcher()
    {
        var next = new FileSystemWatcher(root)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName,
            InternalBufferSize = 16384,
        };
        next.Created += (sender, item) => Add(sender, item.FullPath);
        next.Deleted += (sender, item) => Add(sender, item.FullPath);
        next.Renamed += (sender, item) => Add(sender, item.OldFullPath, item.FullPath);
        next.Error += (sender, item) => Lost(sender, item.GetException());
        lock (gate) watcher = next;
        try { next.EnableRaisingEvents = true; }
        catch { StopWatcher(); throw; }
    }

    private void StopWatcher()
    {
        FileSystemWatcher previous;
        lock (gate)
        {
            previous = watcher;
            watcher = null;
        }
        if (previous != null) previous.Dispose();
    }

    private void RefreshLinkWatcher(bool notify)
    {
        // A junction outside the watched tree can change without notifying
        // either the root watcher or the previous target's directory handle.
        var identity = SwiftTreeWindowsDirectory.TryReadDirectoryIdentity(root);
        var changedTarget = identity != linkIdentity;
        var canWatch = identity != null && !ancestors.Contains(identity);
        if (!changedTarget && (watcher != null || !canWatch)) return;
        StopWatcher();
        linkIdentity = identity;
        if (canWatch)
        {
            StartWatcher();
            if (SwiftTreeWindowsDirectory.TryReadDirectoryIdentity(root) != identity) StopWatcher();
        }
        if (notify && (changedTarget || watcher != null)) Add(null, root);
    }

    public static int Run(string root, string endpoint, string ancestors)
    {
        try
        {
            using (var watch = new SwiftTreeWindowsWatcher(root, ancestors))
            {
                return SwiftTreeWindowsLocalService.Run(endpoint,
                    () => SwiftTreeWindowsDirectory.Trace("watch", root, "ready"), watch.Deliver);
            }
        }
        catch (IOException) { return 1; }
        catch (UnauthorizedAccessException) { return 1; }
        catch (ArgumentException) { return 1; }
    }

    private void Add(object sender, params string[] paths)
    {
        lock (gate)
        {
            if (disposed || (sender != null && sender != watcher) || pending.Contains(root)) return;
            foreach (var path in paths) pending.Add(path);
            if (pending.Count > MaxPaths)
            {
                pending.Clear();
                pending.Add(root);
            }
            changed.Set();
        }
    }

    private void Lost(object sender, Exception error)
    {
        lock (gate)
        {
            if (disposed || sender != watcher) return;
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
        var lastLinkCheck = Stopwatch.StartNew();
        while (!client.Client.Poll(0, SelectMode.SelectRead) || client.Available != 0)
        {
            if (ancestors != null && lastLinkCheck.ElapsedMilliseconds >= LinkCheckMilliseconds)
            {
                RefreshLinkWatcher(true);
                lastLinkCheck.Restart();
            }
            int wait = ancestors == null ? DisconnectCheckMilliseconds : LinkCheckMilliseconds;
            if (!changed.WaitOne(wait))
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
        StopWatcher();
        lock (gate)
        {
            disposed = true;
            changed.Dispose();
        }
    }
}
