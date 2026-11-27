const setup = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
`;

const collation = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

public sealed class SwiftTreeRemoteEntry
{
    public string name { get; private set; }
    public bool directory { get; private set; }

    public SwiftTreeRemoteEntry(string name, bool directory)
    {
        this.name = name;
        this.directory = directory;
    }
}

public static class SwiftTreeWindowsOrder
{
    const int NumericCollation = 7;
    const int On = 17;

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    static extern IntPtr ucol_open(string locale, ref int status);

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    static extern void ucol_setAttribute(IntPtr collator, int attribute, int value, ref int status);

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern int ucol_strcoll(IntPtr collator, string left, int leftLength, string right, int rightLength);

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    static extern void ucol_close(IntPtr collator);

    public static FileSystemInfo[] Sort(FileSystemInfo[] entries, string locale)
    {
        return Sort(entries, entry => entry.Name, entry => entry is DirectoryInfo, locale);
    }

    public static SwiftTreeRemoteEntry[] SortRemote(string listingPath, string locale)
    {
        var bytes = Convert.FromBase64String(File.ReadAllText(listingPath));
        var records = new UTF8Encoding(false, true).GetString(bytes).Split('\0');
        if (records.Length < 2 || records[records.Length - 2] != "" || records[records.Length - 1] != "")
            throw new FormatException("Incomplete directory listing.");

        var entries = new SwiftTreeRemoteEntry[records.Length - 2];
        for (int index = 0; index < entries.Length; index++)
        {
            var record = records[index];
            if (record.Length < 2) throw new FormatException("Invalid directory entry.");
            entries[index] = new SwiftTreeRemoteEntry(record.Substring(1), record[0] == 'd');
        }
        return Sort(entries, entry => entry.name, entry => entry.directory, locale);
    }

    static T[] Sort<T>(T[] entries, Func<T, string> name, Func<T, bool> isDirectory, string locale)
    {
        if (entries.Length < 2) return entries;
        int status = 0;
        IntPtr collator = ucol_open(locale, ref status);
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
            return entries.OrderBy(entry => !isDirectory(entry))
                          .ThenBy(name, compareNames)
                          .ToArray();
        }
        finally
        {
            ucol_close(collator);
        }
    }
}
'@
`;

const localReader = String.raw`
try {
    $entries = [IO.DirectoryInfo]::new($path).GetFileSystemInfos()
    if ($entries.Length -gt 1) {
${collation}
        $entries = [SwiftTreeWindowsOrder]::Sort($entries, (Get-Culture).Name)
    }

    $rows = @(foreach ($entry in $entries) {
        @{ name = $entry.Name; directory = $entry -is [IO.DirectoryInfo] }
    })
    $attributes = [IO.File]::GetAttributes($path)
    if (($attributes -band [IO.FileAttributes]::Directory) -eq 0) {
        throw [IO.DirectoryNotFoundException]::new($path)
    }
    ConvertTo-Json -Compress -Depth 4 -InputObject @{ status = 'ready'; entries = $rows }
}
catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    $status = 'failed'
    if ($cause -is [UnauthorizedAccessException]) { $status = 'denied' }
    elseif ($cause -is [IO.DirectoryNotFoundException] -or $cause -is [IO.FileNotFoundException]) { $status = 'missing' }
    ConvertTo-Json -Compress -InputObject @{ status = $status }
}
`;

const remoteSorter = String.raw`
${collation}
$rows = [SwiftTreeWindowsOrder]::SortRemote($path, (Get-Culture).Name)
ConvertTo-Json -Compress -Depth 4 -InputObject @{ status = 'ready'; entries = $rows }
`;

async function runReader(exec, path, script) {
  try {
    // Pass the path as ASCII data so PowerShell never parses filename characters.
    const encoded = encodeURIComponent(path).replaceAll("'", "%27");
    const { code, stdout } = await exec("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      `$path = [Uri]::UnescapeDataString('${encoded}')\n${setup}\n${script}`,
    ]);
    if (code === 0) {
      return JSON.parse(stdout);
    }
  } catch {
    // Launch and incomplete-output failures have no directory listing.
  }
  return { status: "failed" };
}

export function readWindowsDirectory(exec, folder) {
  return runReader(exec, folder, localReader);
}

export function sortLinuxListing(exec, listingPath) {
  return runReader(exec, listingPath, remoteSorter);
}
