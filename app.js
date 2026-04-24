// 获取页面元素
const historyList = document.getElementById("historyList");
const messagesEl = document.getElementById("messages");
const welcomeEl = document.getElementById("welcome");
const inputEl = document.getElementById("questionInput");
const sendBtn = document.getElementById("sendBtn");
const newChatBtn = document.getElementById("newChatBtn");

// 从浏览器本地存储中读取历史记录
let conversations = JSON.parse(localStorage.getItem("urban_chat_history") || "[]");

// 当前正在打开的本地对话 ID
let currentId = null;

function saveHistory() {
  localStorage.setItem("urban_chat_history", JSON.stringify(conversations));
}

function createConversation() {
  const id = "local_" + Date.now();

  const conversation = {
    id,
    title: "新对话",
    conversation_id: "",
    messages: [],
    updatedAt: new Date().toISOString()
  };

  conversations.unshift(conversation);
  currentId = id;

  saveHistory();
  renderHistory();
  renderMessages();
}

function getCurrentConversation() {
  return conversations.find(item => item.id === currentId);
}

function renderHistory() {
  historyList.innerHTML = "";

  conversations.forEach(item => {
    const div = document.createElement("div");
    div.className = "history-item" + (item.id === currentId ? " active" : "");

    div.innerHTML = `
      <span class="history-text">${escapeHtml(item.title || "新对话")}</span>
      <span class="delete-history" title="删除">×</span>
    `;

    div.querySelector(".history-text").onclick = () => {
      currentId = item.id;
      renderHistory();
      renderMessages();
    };

    div.querySelector(".delete-history").onclick = event => {
      event.stopPropagation();

      conversations = conversations.filter(conv => conv.id !== item.id);

      if (currentId === item.id) {
        currentId = conversations.length > 0 ? conversations[0].id : null;
      }

      if (!currentId) {
        createConversation();
        return;
      }

      saveHistory();
      renderHistory();
      renderMessages();
    };

    historyList.appendChild(div);
  });
}

function renderMessages() {
  const conversation = getCurrentConversation();

  messagesEl.innerHTML = "";

  if (!conversation || conversation.messages.length === 0) {
    welcomeEl.style.display = "block";
    return;
  }

  welcomeEl.style.display = "none";

  conversation.messages.forEach((msg, index) => {
    const row = document.createElement("div");
    row.className = "message-row " + msg.role;

    const wrap = document.createElement("div");
    wrap.className = "message-wrap";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = msg.content;

    wrap.appendChild(bubble);

    // 只有助手回答下面显示操作图标
    if (msg.role === "assistant" && !msg.loading) {
      const actions = document.createElement("div");
      actions.className = "message-actions";

      actions.innerHTML = `
        <button title="复制" onclick="copyMessage(${index})">⧉</button>
        <button title="满意" onclick="feedbackMessage(${index}, 'like')">👍</button>
        <button title="不满意" onclick="feedbackMessage(${index}, 'dislike')">👎</button>
        <button title="分享" onclick="shareMessage(${index})">↗</button>
        <button title="重新生成" onclick="regenerateMessage(${index})">↻</button>
        <button title="更多" onclick="moreMessage(${index})">⋯</button>
      `;

      wrap.appendChild(actions);

      // 推荐追问
      if (msg.followUps && msg.followUps.length > 0) {
        const followBox = document.createElement("div");
        followBox.className = "followups";

        const title = document.createElement("div");
        title.className = "followups-title";
        title.textContent = "你可以继续追问：";

        const list = document.createElement("div");
        list.className = "followups-list";

        msg.followUps.forEach(q => {
          const btn = document.createElement("button");
          btn.className = "followup-btn";
          btn.textContent = q;
          btn.onclick = () => sendQuestion(q);
          list.appendChild(btn);
        });

        followBox.appendChild(title);
        followBox.appendChild(list);
        wrap.appendChild(followBox);
      }
    }

    row.appendChild(wrap);
    messagesEl.appendChild(row);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function sendQuestion(questionText) {
  const question = questionText.trim();

  if (!question) return;

  if (!currentId) {
    createConversation();
  }

  const conversation = getCurrentConversation();

  if (conversation.title === "新对话") {
    conversation.title = question.length > 18 ? question.slice(0, 18) + "..." : question;
  }

  conversation.messages.push({
    role: "user",
    content: question
  });

  conversation.messages.push({
    role: "assistant",
    content: "正在查询知识库，请稍候……",
    loading: true
  });

  conversation.updatedAt = new Date().toISOString();

  saveHistory();
  renderHistory();
  renderMessages();

  inputEl.value = "";
  sendBtn.disabled = true;
  sendBtn.textContent = "生成中";

  try {
  const response = await fetch("/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    question,
    conversation_id: conversation.conversation_id || ""
  })
});

const rawText = await response.text();

let result;
try {
  result = JSON.parse(rawText);
} catch {
  result = {
    error: rawText || "服务器返回内容不是 JSON，请检查 /api/chat 接口是否正常"
  };
}

    // 删除“正在查询知识库”
    conversation.messages.pop();

    if (!response.ok) {
      conversation.messages.push({
        role: "assistant",
        content: result.error || "请求失败，请稍后重试。",
        followUps: []
      });
    } else {
      conversation.conversation_id = result.conversation_id;

      conversation.messages.push({
        role: "assistant",
        content: result.answer || "暂未获取到回答。",
        followUps: result.followUps || []
      });
    }

    conversation.updatedAt = new Date().toISOString();

    saveHistory();
    renderHistory();
    renderMessages();

  } catch (error) {
    conversation.messages.pop();

    conversation.messages.push({
      role: "assistant",
      content: "网络或服务器错误：" + error.message,
      followUps: []
    });

    saveHistory();
    renderMessages();

  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "发送";
    inputEl.focus();
  }
}

// 复制回答
async function copyMessage(index) {
  const conversation = getCurrentConversation();
  const msg = conversation?.messages[index];

  if (!msg) return;

  try {
    await navigator.clipboard.writeText(msg.content);
    showToast("已复制回答内容");
  } catch {
    showToast("复制失败，请手动选择文本复制");
  }
}

// 点赞 / 点踩
function feedbackMessage(index, type) {
  const conversation = getCurrentConversation();
  const msg = conversation?.messages[index];

  if (!msg) return;

  msg.feedback = type;
  saveHistory();

  if (type === "like") {
    showToast("已标记为满意");
  } else {
    showToast("已标记为不满意");
  }
}

// 分享
async function shareMessage(index) {
  const conversation = getCurrentConversation();
  const msg = conversation?.messages[index];

  if (!msg) return;

  const shareText = `城市更新智能问答助手回答：\n\n${msg.content}`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: "城市更新智能问答助手",
        text: shareText
      });
    } catch {
      // 用户取消分享，不处理
    }
  } else {
    await navigator.clipboard.writeText(shareText);
    showToast("当前浏览器不支持直接分享，已复制内容");
  }
}

// 重新生成
function regenerateMessage(index) {
  const conversation = getCurrentConversation();

  if (!conversation) return;

  let lastUserQuestion = "";

  for (let i = index - 1; i >= 0; i--) {
    if (conversation.messages[i].role === "user") {
      lastUserQuestion = conversation.messages[i].content;
      break;
    }
  }

  if (!lastUserQuestion) {
    showToast("未找到对应的用户问题");
    return;
  }

  // 删除当前助手回答
  conversation.messages.splice(index, 1);
  saveHistory();
  renderMessages();

  // 重新发送上一条用户问题
  sendQuestion(lastUserQuestion);
}

// 更多
function moreMessage(index) {
  showToast("更多功能可扩展：收藏、导出、引用来源等");
}

// 简单提示
function showToast(text) {
  let toast = document.getElementById("toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = text;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 1800);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

sendBtn.onclick = () => {
  sendQuestion(inputEl.value);
};

inputEl.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendQuestion(inputEl.value);
  }
});

newChatBtn.onclick = () => {
  createConversation();
};

document.querySelectorAll(".quick-question").forEach(btn => {
  btn.onclick = () => {
    sendQuestion(btn.textContent);
  };
});

if (conversations.length > 0) {
  currentId = conversations[0].id;
} else {
  createConversation();
}

renderHistory();
renderMessages();
