import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function main() {
  const chatCompletion = await generateTriviaQuestion();
  // Print the completion returned by the LLM.
  console.log(chatCompletion.choices[0]?.message?.content || "");
}

const recentQuestions = []; // guarda as últimas perguntas

export async function generateTriviaQuestion() {
  const topics = [
    "history",
    "science",
    "geography",
    "sports",
    "movies",
    "music",
    "food",
    "technology",
    "animals",
    "literature",
  ];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const answerPosition = ["A", "B", "C", "D"][Math.floor(Math.random() * 4)];

  const avoidSection =
    recentQuestions.length > 0
      ? `Do NOT ask about any of these recent questions:\n${recentQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
      : "";

  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: "user",
        content: `Generate a fun and unpredictable trivia question about ${topic}. Seed: ${Math.random()} - ${Date.now()}.
${avoidSection}
Only ONE option must be correct, and the correct answer MUST be option ${answerPosition}.
Respond ONLY with a valid JSON object, no markdown, no explanation:
{
  "question": "...",
  "options": {
    "A": "...",
    "B": "...",
    "C": "...",
    "D": "..."
  },
  "answer": "${answerPosition}"
}`,
      },
    ],
    model: "llama-3.3-70b-versatile",
    temperature: 1.5,
    seed: Math.floor(Math.random() * 1000000),
  });

  const raw = completion.choices[0]?.message?.content || "";
  const clean = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);

  // Guarda a pergunta para evitar repetição (máximo 20)
  recentQuestions.push(parsed.question);
  if (recentQuestions.length > 20) recentQuestions.shift();

  return parsed;
}

export async function explainTopic(topic) {
  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: "user",
        content: `Please provide a clear, concise explanation of: ${topic}. Keep it informative but brief (2-3 short paragraphs max).`,
      },
    ],
    model: "llama-3.3-70b-versatile",
    temperature: 0.7,
  });

  return completion.choices[0]?.message?.content || "Unable to generate explanation.";
}
