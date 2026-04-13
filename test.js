import {generateTriviaQuestion } from "./src/integrations/groq.js";

const question = await generateTriviaQuestion();

console.log(question.choices[0]?.message?.content || "");