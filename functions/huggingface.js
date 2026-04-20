exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { prompt, key } = JSON.parse(event.body);
    console.log("Hugging Face function called for prompt:", prompt.slice(0, 50) + "...");

    if (!key || !prompt) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: { message: "Ключ или промпт отсутствуют" } }) 
      };
    }

    // Используем Qwen 2.5 72B Instruct через Hugging Face Inference API (OpenAI-совместимый эндпоинт)
    const modelId = "Qwen/Qwen2.5-72B-Instruct";
    const url = "https://api-inference.huggingface.co/v1/chat/completions";
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: "You are a helpful assistant that generates mnemonic associations. Respond only with JSON." },
          { role: "user", content: prompt }
        ],
        max_tokens: 500,
        stream: false
      })
    });

    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error("Non-JSON response from HF:", text.slice(0, 200));
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: { message: `HF вернул не JSON (код ${response.status}). Возможно, модель еще загружается или неверный URL.` } })
      };
    }
    
    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: { message: data.error || "Hugging Face API Error" } })
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    console.error("HF Function Error:", error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: { message: error.message } }) 
    };
  }
};
