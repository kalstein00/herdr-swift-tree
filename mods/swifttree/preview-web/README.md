# Expanded preview assets

The Windows installer extracts `site.zip` into the WebView2 host's local site. Build from this directory with `npm ci`, then `npm run build`, and archive the files at the root of `dist/` into `site.zip`. `dist/THIRD-PARTY-NOTICES.txt` lists licenses for the packages used by the web bundle. Installation uses the checked-in archive and needs no npm download.

`../preview-sdk` contains the .NET Framework assemblies, native loaders, license and notices from [Microsoft.Web.WebView2 1.0.3912.50](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3912.50). The package SHA-256 is `8DD696301D8E5AD8389F26B636329BBF35754B793974E82168B1F6DDA234EB07`. The runtime is installed in Windows separately from these SDK files.
