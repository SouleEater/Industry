# Read-only render of the user's PPTX files; PowerPoint must be installed on Windows.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$ppt = New-Object -ComObject PowerPoint.Application
$ppt.AutomationSecurity = 3 # ForceDisable macros
try {
    foreach ($scanId in @('009', '024', '116', '117', '128')) {
        $sourcePath = Join-Path $projectRoot "research/imported/base/$scanId.pptx"
        $renderPath = Join-Path $projectRoot "research/imported/base/slides-$scanId"
        New-Item -ItemType Directory -Force -Path $renderPath | Out-Null
        $deck = $ppt.Presentations.Open($sourcePath, -1, 0, 0)
        try { $deck.Export($renderPath, 'PNG', 900) } finally { $deck.Close() }
    }
} finally {
    $ppt.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
