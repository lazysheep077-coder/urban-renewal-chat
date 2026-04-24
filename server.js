const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

// 让 public 文件夹里的 index.html、style.css、app.js 可以被浏览器访问
app.use(express.static(path.join(__dirname, "public")));

const COZE_API_BASE = "https://api.coze.cn";
const BOT_ID = process.env.COZE_BOT_ID;
const TOKEN = process.env.COZE_TOKEN;
const PORT = process.env.PORT || 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 统一请求扣子 API
async function cozeFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`扣子 API 请求失败：${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

// 前端调用这个接口来提问
app.post("/api/chat", async (req, res) => {
  try {
    const { question, conversation_id } = req.body;

    if (!BOT_ID || !TOKEN) {
      return res.status(500).json({
        error: "服务器缺少 COZE_BOT_ID 或 COZE_TOKEN，请检查 .env 文件"
      });
    }

    if (!question || !question.trim()) {
      return res.status(400).json({
        error: "问题不能为空"
      });
    }

    // 1. 发起对话
    let chatUrl = `${COZE_API_BASE}/v3/chat`;

    // 如果是继续历史对话，就带上 conversation_id
    if (conversation_id) {
      chatUrl += `?conversation_id=${encodeURIComponent(conversation_id)}`;
    }

    const chatResult = await cozeFetch(chatUrl, {
      method: "POST",
      body: JSON.stringify({
        bot_id: BOT_ID,
        user_id: "urban_renewal_user_001",
        stream: false,
        auto_save_history: true,
        enable_card: false,
        publish_status: "published_online",
        additional_messages: [
          {
            role: "user",
            type: "question",
            content_type: "text",
            content: question
          }
        ],
        parameters: {}
      })
    });

    if (chatResult.code !== 0) {
      return res.status(500).json({
        error: chatResult.msg || "发起对话失败",
        detail: chatResult
      });
    }

    const newConversationId = chatResult.data.conversation_id;
    const chatId = chatResult.data.id;

    if (!newConversationId || !chatId) {
      return res.status(500).json({
        error: "没有获取到 conversation_id 或 chat_id",
        detail: chatResult
      });
    }

    // 2. 查询对话状态，直到 completed
    let status = "in_progress";

    for (let i = 0; i < 180; i++){
      await sleep(1000);

      const retrieveUrl =
        `${COZE_API_BASE}/v3/chat/retrieve?conversation_id=${newConversationId}&chat_id=${chatId}`;

      const retrieveResult = await cozeFetch(retrieveUrl, {
        method: "GET"
      });

      status = retrieveResult.data.status;

      if (status === "completed") {
        break;
      }

      if (["failed", "canceled", "required_action"].includes(status)) {
        return res.status(500).json({
          error: `对话状态异常：${status}`,
          detail: retrieveResult
        });
      }
    }

    if (status !== "completed") {
      return res.status(504).json({
        error: "回答生成超时，请稍后重试"
      });
    }

    // 3. 获取最终消息列表
    const messageUrl =
      `${COZE_API_BASE}/v3/chat/message/list?conversation_id=${newConversationId}&chat_id=${chatId}`;

    const messageResult = await cozeFetch(messageUrl, {
      method: "GET"
    });

    if (messageResult.code !== 0) {
      return res.status(500).json({
        error: messageResult.msg || "获取消息失败",
        detail: messageResult
      });
    }

    // 4. 只取 type = answer 的最终回答
    const answers = messageResult.data.filter((item) => item.type === "answer");

    const answer = answers.length > 0
      ? answers[answers.length - 1].content
      : "暂未获取到智能体回答。";

    // 5. 可选：获取推荐追问
    const followUps = messageResult.data
      .filter((item) => item.type === "follow_up")
      .map((item) => item.content);

    // 6. 返回给前端
    res.json({
      conversation_id: newConversationId,
      chat_id: chatId,
      answer,
      followUps
    });

  } catch (error) {
    console.error("服务器错误：", error);

    res.status(500).json({
      error: error.message || "服务器错误"
    });
  }
});

// 首页兜底
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`城市更新智能问答系统已启动：http://localhost:${PORT}`);
});