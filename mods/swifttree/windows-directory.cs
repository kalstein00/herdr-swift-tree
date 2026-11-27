using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

internal static class SwiftTreeWindowsDirectory
{
    private const int NumericCollation = 7;
    private const int On = 17;

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    private static extern IntPtr ucol_open(string locale, ref int status);

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    private static extern void ucol_setAttribute(IntPtr collator, int attribute, int value, ref int status);

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int ucol_strcoll(IntPtr collator, string left, int leftLength, string right, int rightLength);

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    private static extern void ucol_close(IntPtr collator);

    internal sealed class Entry
    {
        public string name { get; private set; }
        public bool directory { get; private set; }

        public Entry(string name, bool directory)
        {
            this.name = name;
            this.directory = directory;
        }
    }

    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

    internal static string Serialize(object value)
    {
        lock (Json) return Json.Serialize(value);
    }

    internal static T Deserialize<T>(string value)
    {
        lock (Json) return Json.Deserialize<T>(value);
    }

    public static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length < 2) return 2;
        if (args[0] == "watch-worker" && args.Length == 3)
            return SwiftTreeWindowsWatcher.Run(Decode(args[1]), Decode(args[2]));
        if (args[0] == "directory-worker" && args.Length == 3)
            return SwiftTreeWindowsDirectoryServer.Run(Decode(args[1]), Decode(args[2]));

        try
        {
            Entry[] entries;
            switch (args[0])
            {
                case "list":
                    Trace("list", args[1], args.Length == 3 ? args[2] : "open");
                    entries = ReadDirectory(args[1]);
                    break;
                case "sort-linux":
                    entries = ReadLinuxListing(args[1]);
                    break;
                case "start-watch":
                    if (args.Length != 3) return 2;
                    return LaunchWorker("watch-worker", args[1], args[2]);
                case "start-directory":
                    if (args.Length != 3) return 2;
                    return LaunchWorker("directory-worker", args[1], args[2]);
                default:
                    return 2;
            }

            Console.WriteLine(Serialize(new { status = "ready", entries = entries }));
        }
        catch (UnauthorizedAccessException) { WriteStatus("denied"); }
        catch (DirectoryNotFoundException) { WriteStatus("missing"); }
        catch (FileNotFoundException) { WriteStatus("missing"); }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            WriteStatus("failed");
        }
        return 0;
    }

    private static void WriteStatus(string status)
    {
        Console.WriteLine(Serialize(new { status = status }));
    }

    private static int LaunchWorker(string mode, string argument, string endpoint)
    {
        var start = new ProcessStartInfo
        {
            FileName = Process.GetCurrentProcess().MainModule.FileName,
            Arguments = mode + " " + Encode(argument) + " " + Encode(endpoint),
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        using (Process.Start(start)) { }
        return 0;
    }

    private static string Encode(string value)
    {
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(value));
    }

    private static string Decode(string value)
    {
        return Encoding.UTF8.GetString(Convert.FromBase64String(value));
    }

    internal static Entry[] ReadDirectory(string folder)
    {
        var entries = new DirectoryInfo(folder).GetFileSystemInfos()
            .Select(entry => new Entry(entry.Name, entry is DirectoryInfo)).ToArray();
        var sorted = Sort(entries);
        if ((File.GetAttributes(folder) & FileAttributes.Directory) == 0)
            throw new DirectoryNotFoundException("The folder was replaced.");
        return sorted;
    }

    private static Entry[] ReadLinuxListing(string path)
    {
        return DecodeLinuxListing(File.ReadAllText(path));
    }

    internal static Entry[] DecodeLinuxListing(string listing)
    {
        var bytes = Convert.FromBase64String(listing);
        var records = new UTF8Encoding(false, true).GetString(bytes).Split('\0');
        if (records.Length < 2 || records[records.Length - 2] != "" || records[records.Length - 1] != "")
            throw new FormatException("Incomplete directory listing.");

        var entries = new Entry[records.Length - 2];
        for (int index = 0; index < entries.Length; index++)
        {
            var record = records[index];
            if (record.Length < 2) throw new FormatException("Invalid directory entry.");
            entries[index] = new Entry(record.Substring(1), record[0] == 'd');
        }
        return Sort(entries);
    }

    private static Entry[] Sort(Entry[] entries)
    {
        if (entries.Length < 2) return entries;
        int status = 0;
        var locale = CultureInfo.CurrentCulture.Name;
        var collator = ucol_open(locale, ref status);
        if (collator == IntPtr.Zero) throw new InvalidOperationException("Could not open the Windows collator.");

        try
        {
            if (status > 0) throw new InvalidOperationException("Could not open the Windows collator.");
            ucol_setAttribute(collator, NumericCollation, On, ref status);
            if (status > 0) throw new InvalidOperationException("Could not enable numeric file ordering.");

            var compareNames = Comparer<string>.Create((left, right) =>
            {
                int order = ucol_strcoll(collator, left, left.Length, right, right.Length);
                return order != 0 ? order : left.Length.CompareTo(right.Length);
            });
            return entries.OrderBy(entry => !entry.directory)
                          .ThenBy(entry => entry.name, compareNames)
                          .ToArray();
        }
        finally
        {
            ucol_close(collator);
        }
    }

    internal static void Trace(string operation, string folder, string reason)
    {
        var destination = Environment.GetEnvironmentVariable("SWIFTTREE_WINDOWS_TRACE");
        if (!Directory.Exists(destination)) return;

        var record = new { operation = operation, folder = folder, reason = reason, pid = Process.GetCurrentProcess().Id,
            timestamp = Stopwatch.GetTimestamp(), frequency = Stopwatch.Frequency };
        try
        {
            var path = Path.Combine(destination, Guid.NewGuid().ToString("N") + ".json");
            File.WriteAllText(path, Serialize(record), new UTF8Encoding(false));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
