$documentPath = (Resolve-Path -LiteralPath 'output/workshop-guide/AIxRay_Process_Workshop_Guide.docx').Path
$pdfPath = Join-Path (Split-Path -Parent $documentPath) '_work/AIxRay_Process_Workshop_Guide.pdf'
$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($documentPath, $false, $true)
  $document.Repaginate()
  $pages = $document.ComputeStatistics(2)
  $document.ExportAsFixedFormat($pdfPath, 17)
  Write-Output "Rendered with Microsoft Word: $pages pages"
  Write-Output $pdfPath
} finally {
  if ($null -ne $document) { $document.Close(0) }
  if ($null -ne $word) { $word.Quit() }
}
