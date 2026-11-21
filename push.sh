#!/usr/bin/env bash
# DSH Agent Swarm Console — 一键 push
#
# 用法：  bash push.sh
#
# 解决本机三个具体问题：
#   1. WorkBuddy 的代理（127.0.0.1:63121）经常 502，git 继承后会 Connection was reset
#      → 这里把 git 指向 Windows 系统代理（默认 26561，可用 GIT_PROXY 覆盖）
#   2. 该代理是自签证书，git 的 schannel 会报 CRYPT_E_NO_REVOCATION_CHECK
#      → 这里对本次 push 关闭 SSL 校验（仅本次，不写进全局配置）
#   3. credential.helper 未设置时会卡在 "could not read Username"
#      → 用 GIT_ASKPASS 提供用户名/令牌
#
# 令牌从环境变量或 ~/.workbuddy/env/dsh-agent-credentials.sh 读取，不写死在仓库里。

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

GIT_PROXY="${GIT_PROXY:-http://127.0.0.1:26561}"
GITHUB_USERNAME="${GITHUB_USERNAME:-whyissodifficult}"

# ── 1. 加载凭据 ──
CRED_FILE="$HOME/.workbuddy/env/dsh-agent-credentials.sh"
if [ -f "$CRED_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CRED_FILE"
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "❌ 没找到 GITHUB_TOKEN"
  echo ""
  echo "创建 Personal Access Token："
  echo "  1. 打开 https://github.com/settings/tokens"
  echo "  2. Generate new token (classic)"
  echo "  3. Note 填 dsh-swarm-console，勾选 repo 权限"
  echo "  4. 生成后复制那串 token"
  echo ""
  echo "然后： export GITHUB_TOKEN='你的token' && bash push.sh"
  echo "（或写进 $CRED_FILE，之后就不用再设了）"
  exit 1
fi

# ── 2. 免交互凭据（用 trap 保证一定清理）──
ASKPASS_SCRIPT="$(mktemp)"
trap 'rm -f "$ASKPASS_SCRIPT"' EXIT
cat > "$ASKPASS_SCRIPT" << EOF
#!/usr/bin/env bash
case "\$1" in
  *Username*) echo "$GITHUB_USERNAME" ;;
  *Password*) echo "$GITHUB_TOKEN" ;;
  *) echo "" ;;
esac
EOF
chmod +x "$ASKPASS_SCRIPT"
export GIT_ASKPASS="$ASKPASS_SCRIPT"
export GIT_TERMINAL_PROMPT=0

# ── 3. 走系统代理 + 绕过证书吊销检查 ──
export http_proxy="$GIT_PROXY" https_proxy="$GIT_PROXY"
export HTTP_PROXY="$GIT_PROXY" HTTPS_PROXY="$GIT_PROXY"

# ── 4. push（失败要明确返回非 0，trap 负责清理临时文件）──
echo "▶ 推送到 origin/main （代理 $GIT_PROXY）..."
if git -c http.sslVerify=false -c http.schannelCheckRevoke=false push -u origin main; then
  echo "✅ push 成功"
else
  echo "❌ push 失败"
  exit 1
fi
