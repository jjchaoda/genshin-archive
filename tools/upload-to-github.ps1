# =============================================================================
#  提瓦特档案 · 一键上传到 GitHub
#  用法（在项目根目录执行）：
#     $env:GH_TOKEN = 'ghp_xxx'          # classic token，勾选 public_repo
#     powershell -File tools/upload-to-github.ps1 -EnablePages
#
#  说明：本机 git 协议访问 github.com:443 会被重置，但 api.github.com 可用，
#        因此走 GitHub REST API 上传：
#          1) 空仓库先用 Contents API 放一个 .gitignore 做引导提交（否则 blob 接口返回 409）
#          2) 再用 Git Data API 把全部文件拼成一棵树，作为引导提交的后续提交
# =============================================================================
[CmdletBinding()]
param(
  [string]$Token = $env:GH_TOKEN,
  [string]$RepoName = 'genshin-archive',
  [string]$Description = '提瓦特档案 · 原神资料站 —— 官方实机影像 / 52 个版本里程碑 / 获奖记录，纯前端 HTML+CSS+JS，数据存 localStorage',
  [string]$CommitMessage = 'feat: 提瓦特档案 · 原神资料站（实机影像 / 版本里程碑 / 获奖记录 + localStorage 持久化）',
  [switch]$EnablePages
)

$ErrorActionPreference = 'Stop'
if (-not $Token) { throw '缺失 token：请设置 $env:GH_TOKEN 或 -Token 参数（classic token，勾选 public_repo）' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$api = 'https://api.github.com'
$headers = @{
  Authorization          = "Bearer $Token"
  Accept                 = 'application/vnd.github+json'
  'User-Agent'           = 'genshin-archive-uploader'
  'X-GitHub-Api-Version' = '2022-11-28'
}

function Invoke-GH {
  param([string]$Method, [string]$Path, $Body)
  $p = @{ Method = $Method; Uri = "$api$Path"; Headers = $headers; ContentType = 'application/json; charset=utf-8' }
  if ($null -ne $Body) { $p.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 8 -Compress)) }
  return Invoke-RestMethod @p
}

# ---------- 1) 认证 ----------
$me = Invoke-GH -Method GET -Path '/user'
$owner = $me.login
Write-Host "[1/6] 已认证：$owner" -ForegroundColor Green

# ---------- 2) 创建仓库 ----------
try {
  Invoke-GH -Method POST -Path '/user/repos' -Body @{
    name = $RepoName; private = $false; description = $Description
    has_issues = $true; has_wiki = $false; has_projects = $false; auto_init = $false
  } | Out-Null
  Write-Host "[2/6] 已创建公开仓库 $owner/$RepoName" -ForegroundColor Green
} catch {
  Write-Host "[2/6] 仓库已存在，继续" -ForegroundColor Yellow
}
$repo = Invoke-GH -Method GET -Path "/repos/$owner/$RepoName"
$branch = $repo.default_branch
if (-not $branch) { $branch = 'main' }

# ---------- 3) 确定父提交（空仓库先做引导提交） ----------
$parent = $null
try {
  $parent = (Invoke-GH -Method GET -Path "/repos/$owner/$RepoName/git/ref/heads/$branch").object.sha
  Write-Host "[3/6] 分支 $branch 已存在，父提交 $($parent.Substring(0,10))"
} catch {
  $gi = Join-Path $root '.gitignore'
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($gi))
  $boot = Invoke-GH -Method PUT -Path "/repos/$owner/$RepoName/contents/.gitignore" -Body @{
    message = 'chore: 初始化仓库'; content = $b64; branch = $branch
  }
  $parent = $boot.commit.sha
  Write-Host "[3/6] 已创建引导提交 $($parent.Substring(0,10))" -ForegroundColor Green
}

# ---------- 4) 上传全部文件为 blob ----------
$files = Get-ChildItem -Recurse -File -Force | Where-Object {
  $rel = $_.FullName.Substring($root.Length + 1)
  ($rel -notmatch '^\.git\\') -and ($rel -notmatch '^node_modules\\') -and ($rel -notmatch '^\.tmp')
}
$tree = @()
foreach ($f in $files) {
  $rel = ($f.FullName.Substring($root.Length + 1)) -replace '\\', '/'
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName))
  $blob = Invoke-GH -Method POST -Path "/repos/$owner/$RepoName/git/blobs" -Body @{ content = $b64; encoding = 'base64' }
  $tree += @{ path = $rel; mode = '100644'; type = 'blob'; sha = $blob.sha }
  Write-Host ("       + {0,-30} {1,7} bytes" -f $rel, $f.Length)
}
Write-Host "[4/6] 已上传 $($tree.Count) 个文件" -ForegroundColor Green

# ---------- 5) 生成 tree / commit 并更新分支 ----------
$newTree = Invoke-GH -Method POST -Path "/repos/$owner/$RepoName/git/trees" -Body @{ tree = $tree }
$parents = @()
if ($parent) { $parents = @($parent) }
$commit = Invoke-GH -Method POST -Path "/repos/$owner/$RepoName/git/commits" -Body @{
  message = $CommitMessage; tree = $newTree.sha; parents = $parents
}
Invoke-GH -Method PATCH -Path "/repos/$owner/$RepoName/git/refs/heads/$branch" -Body @{ sha = $commit.sha; force = $true } | Out-Null
Invoke-GH -Method PATCH -Path "/repos/$owner/$RepoName" -Body @{
  description = $Description; default_branch = $branch; has_wiki = $false; has_projects = $false
} | Out-Null
try { Invoke-GH -Method PUT -Path "/repos/$owner/$RepoName/topics" -Body @{ names = @('genshin-impact','html','css','javascript','localstorage','fan-site') } | Out-Null } catch {}
Write-Host "[5/6] 提交 $($commit.sha.Substring(0,10)) 已推到 $branch 分支" -ForegroundColor Green

$repoUrl = "https://github.com/$owner/$RepoName"

# ---------- 6) 可选：开启 GitHub Pages ----------
if ($EnablePages) {
  try {
    Invoke-GH -Method POST -Path "/repos/$owner/$RepoName/pages" -Body @{ source = @{ branch = $branch; path = '/' } } | Out-Null
    Write-Host "[6/6] GitHub Pages 已开启" -ForegroundColor Green
  } catch {
    Write-Host "[6/6] Pages 开启失败（可到 Settings → Pages 手动选 $branch / root）：$($_.Exception.Message)" -ForegroundColor Yellow
  }
  $pagesUrl = "https://$owner.github.io/$RepoName/"
  try { Invoke-GH -Method PATCH -Path "/repos/$owner/$RepoName" -Body @{ homepage = $pagesUrl } | Out-Null } catch {}
  Start-Sleep -Seconds 6
  try {
    $st = Invoke-GH -Method GET -Path "/repos/$owner/$RepoName/pages"
    Write-Host "      Pages 状态：$($st.status) · 地址：$($st.html_url)" -ForegroundColor Cyan
  } catch {
    Write-Host "      Pages 地址（首次构建约 1 分钟）：$pagesUrl" -ForegroundColor Cyan
  }
}

# ---------- 本地 remote ----------
& git remote remove origin 2>$null
& git remote add origin "https://github.com/$owner/$RepoName.git"
Write-Host "`n完成：$repoUrl" -ForegroundColor Cyan
