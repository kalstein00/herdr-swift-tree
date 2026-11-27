using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

internal sealed class SwiftTreeWindowsCoreBridge : IDisposable
{
    private readonly object gate = new object();
    private readonly Stack<Connection> idle = new Stack<Connection>();
    private readonly HashSet<Connection> connections = new HashSet<Connection>();
    private readonly SemaphoreSlim slots = new SemaphoreSlim(2);
    private readonly string executable;
    private bool disposed;

    public SwiftTreeWindowsCoreBridge(string processId)
    {
        int id;
        if (!int.TryParse(processId, out id) || id <= 0) return;
        try
        {
            using (var core = Process.GetProcessById(id))
                executable = core.MainModule.FileName;
        }
        catch (ArgumentException) { }
        catch (System.ComponentModel.Win32Exception) { }
        catch (InvalidOperationException) { }
    }

    public object List(string machine, string script, string folder)
    {
        if (executable == null) return null;
        slots.Wait();
        Connection connection = null;
        bool reusable = false;
        try
        {
            lock (gate)
            {
                if (disposed) return null;
                connection = idle.Count == 0 ? new Connection(executable) : idle.Pop();
                connections.Add(connection);
            }
            var response = connection.List(machine, script, folder);
            reusable = true;
            return response;
        }
        catch (IOException) { return null; }
        catch (InvalidOperationException) { return null; }
        catch (System.ComponentModel.Win32Exception) { return null; }
        finally
        {
            if (connection != null)
            {
                lock (gate)
                {
                    if (reusable && !disposed) idle.Push(connection);
                    else if (connections.Remove(connection)) connection.Dispose();
                }
            }
            slots.Release();
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            disposed = true;
            foreach (var connection in connections) connection.Dispose();
            connections.Clear();
            idle.Clear();
        }
    }

    private sealed class Connection : IDisposable
    {
        private readonly Process process;
        private readonly StreamWriter input;

        public Connection(string executable)
        {
            process = Process.Start(new ProcessStartInfo
            {
                FileName = executable,
                Arguments = "connect",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = new UTF8Encoding(false, true),
            });
            process.ErrorDataReceived += (sender, data) => { };
            process.BeginErrorReadLine();
            input = new StreamWriter(process.StandardInput.BaseStream, new UTF8Encoding(false, true)) { AutoFlush = true };
        }

        public object List(string machine, string script, string folder)
        {
            input.WriteLine(SwiftTreeWindowsDirectory.Serialize(new
            {
                jsonrpc = "2.0",
                id = 1,
                method = "machine.exec",
                @params = new { on = machine, argv = new[] { "sh", "-c", script, "swifttree", folder }, timeout = 30 },
            }));
            var line = process.StandardOutput.ReadLine();
            if (line == null) throw new IOException("The Herdr core bridge disconnected.");
            var reply = SwiftTreeWindowsDirectory.Deserialize<CoreReply>(line);
            if (reply == null || reply.id != 1) throw new IOException("Invalid Herdr core response.");
            var result = reply.result;
            if (result == null || result.timed_out || result.truncated) return null;
            if (result.code == 43) return new { status = "denied" };
            if (result.code == 44) return new { status = "missing" };
            if (result.code != 0 || result.stdout == null) return null;
            return new { status = "ready", entries = SwiftTreeWindowsDirectory.DecodeLinuxListing(result.stdout) };
        }

        public void Dispose()
        {
            try
            {
                if (!process.HasExited) process.Kill();
            }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
            finally
            {
                process.Dispose();
            }
        }
    }

    private sealed class CoreReply
    {
        public int id { get; set; }
        public CoreResult result { get; set; }
    }

    private sealed class CoreResult
    {
        public int? code { get; set; }
        public bool timed_out { get; set; }
        public bool truncated { get; set; }
        public string stdout { get; set; }
    }
}
