param(
    [Parameter(Mandatory=$true)][string]$DocxPath,
    [Parameter(Mandatory=$true)][string]$PdfPath,
    [Parameter(Mandatory=$false)][int]$OptimizeFor = 0 # 0 = wdExportOptimizeForPrint (full original crystal-clear image & logo resolution), 1 = wdExportOptimizeForOnScreen
)

$word = $null
$doc = $null
$tempDocx = $null

try {
    # Resolve full absolute paths
    $DocxPath = [System.IO.Path]::GetFullPath($DocxPath)
    $PdfPath  = [System.IO.Path]::GetFullPath($PdfPath)

    if (-not (Test-Path $DocxPath)) {
        Write-Error "Source DOCX file not found: $DocxPath"
        exit 1
    }

    $pdfDir = [System.IO.Path]::GetDirectoryName($PdfPath)
    if (-not (Test-Path $pdfDir)) {
        New-Item -ItemType Directory -Path $pdfDir -Force | Out-Null
    }

    # Delete existing target PDF if present to ensure fresh export
    if (Test-Path $PdfPath) {
        try { Remove-Item $PdfPath -Force -ErrorAction SilentlyContinue } catch {}
    }

    # Use a clean isolated temporary copy so Word NEVER triggers Document Recovery prompts
    $tempDocx = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "pdfgen_" + [System.Guid]::NewGuid().ToString("N") + ".docx")
    Copy-Item -Path $DocxPath -Destination $tempDocx -Force

    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0 # wdAlertsNone

    try {
        $word.Options.UpdateLinksAtOpen = $false
        $word.Options.WarnBeforeSavingPrintingSendingMarkup = $false
    } catch {}

    # Open document in ReadOnly mode ($true)
    $doc = $word.Documents.Open($tempDocx, $false, $true)

    # Update Table of Contents in memory if present
    try {
        if ($doc.TablesOfContents.Count -gt 0) {
            $doc.TablesOfContents.Item(1).Update()
        }
    } catch {
        # Ignore non-fatal TOC update errors
    }

    # wdExportFormatPDF = 17
    # OptimizeFor: 0 = wdExportOptimizeForPrint (high-res), 1 = wdExportOptimizeForOnScreen (optimized for web/screen, minimal size)
    $doc.ExportAsFixedFormat($PdfPath, 17, $false, $OptimizeFor)
    Write-Output "PDF_CONVERTED_OK"
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
finally {
    if ($doc) {
        try { $doc.Close(0) } catch {}
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null
        $doc = $null
    }
    if ($word) {
        try { $word.Quit(0) } catch {}
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
        $word = $null
    }
    if ($tempDocx -and (Test-Path $tempDocx)) {
        try { Remove-Item -Path $tempDocx -Force -ErrorAction SilentlyContinue } catch {}
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
