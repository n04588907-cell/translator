exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { prompt, key } = JSON.parse(event.body);
    console.log("DeepSeek function called for prompt:", prompt.slice(0, 50) + "...");

    if (!key || !prompt) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: { message: "Ключ или промпт отсутствуют" } }) 
      };
    }

    const url = "https://api.deepseek.com/chat/completions";
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are a helpful assistant that generates mnemonic associations." },
          { role: "user", content: prompt }
        ],
        stream: false
      })
    });

    const data = await response.json();
    
    return {
      statusCode: response.status,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: { message: error.message } }) 
    };
  }
};
