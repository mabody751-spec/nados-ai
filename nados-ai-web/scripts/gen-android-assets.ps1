Add-Type -AssemblyName System.Drawing

$root = "D:\nadosai\nados-ai-web\assets"
New-Item -ItemType Directory -Force -Path $root | Out-Null

$dark = [System.Drawing.Color]::FromArgb(15, 21, 18)
$mint = [System.Drawing.Color]::FromArgb(53, 184, 169)
$white = [System.Drawing.Color]::FromArgb(244, 245, 242)

function New-GlyphIcon([string]$path, [int]$size, [bool]$transparent, [double]$scale) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  if ($transparent) { $g.Clear([System.Drawing.Color]::Transparent) }
  else { $g.Clear($dark) }
  $fontSize = [float]($size * $scale)
  $font = New-Object System.Drawing.Font 'Segoe UI', $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush $mint
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $g.DrawString('N', $font, $brush, $rect, $sf)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

function New-Splash([string]$path) {
  $size = 2732
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear($dark)
  $fontGlyph = New-Object System.Drawing.Font 'Segoe UI', 1100, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $mintBrush = New-Object System.Drawing.SolidBrush $mint
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $glyphRect = New-Object System.Drawing.RectangleF 0, 300, $size, 1400
  $g.DrawString('N', $fontGlyph, $mintBrush, $glyphRect, $sf)
  $fontLabel = New-Object System.Drawing.Font 'Segoe UI', 200, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
  $whiteBrush = New-Object System.Drawing.SolidBrush $white
  $labelRect = New-Object System.Drawing.RectangleF 0, 1850, $size, 400
  $g.DrawString('Nados AI', $fontLabel, $whiteBrush, $labelRect, $sf)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-GlyphIcon "$root\icon.png" 1024 $false 0.62
New-GlyphIcon "$root\icon-foreground.png" 1024 $true 0.42
New-GlyphIcon "$root\icon-background.png" 1024 $false 0.0
New-Splash "$root\splash.png"
New-Splash "$root\splash-dark.png"
Get-ChildItem $root | Select-Object Name, Length
