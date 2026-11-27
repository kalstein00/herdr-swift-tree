const reader = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

try {
    $entries = [IO.DirectoryInfo]::new($folder).GetFileSystemInfos()
    if ($entries.Length -gt 1) {
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

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
            return entries.OrderBy(entry => !(entry is DirectoryInfo))
                          .ThenBy(entry => entry.Name, compareNames)
                          .ToArray();
        }
        finally
        {
            ucol_close(collator);
        }
    }
}
'@
        $entries = [SwiftTreeWindowsOrder]::Sort($entries, (Get-Culture).Name)
    }

    $rows = @(foreach ($entry in $entries) {
        @{ name = $entry.Name; directory = $entry -is [IO.DirectoryInfo] }
    })
    $attributes = [IO.File]::GetAttributes($folder)
    if (($attributes -band [IO.FileAttributes]::Directory) -eq 0) {
        throw [IO.DirectoryNotFoundException]::new($folder)
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

export async function readWindowsDirectory(exec, folder) {
  try {
    // Pass the path as ASCII data so PowerShell never parses filename characters.
    const encoded = encodeURIComponent(folder).replaceAll("'", "%27");
    const { code, stdout } = await exec("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      `$folder = [Uri]::UnescapeDataString('${encoded}')\n${reader}`,
    ]);
    if (code === 0) {
      return JSON.parse(stdout);
    }
  } catch {
    // Launch and incomplete-output failures have no directory listing.
  }
  return { status: "failed" };
}
