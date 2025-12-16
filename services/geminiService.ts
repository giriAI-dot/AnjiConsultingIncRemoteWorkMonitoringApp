import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from '../types';

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY not found in environment");
  return new GoogleGenAI({ apiKey });
};

export const analyzeSessionContext = async (
  base64Image: string,
  audioData: { base64: string; mimeType: string } | null
): Promise<AnalysisResult> => {
  try {
    const ai = getClient();
    
    const parts: any[] = [
      {
        inlineData: {
          mimeType: "image/png",
          data: base64Image
        }
      }
    ];

    if (audioData) {
      parts.push({
        inlineData: {
          mimeType: audioData.mimeType,
          data: audioData.base64
        }
      });
    }

    parts.push({
      text: `Analyze this snapshot of an employee's screen ${audioData ? 'and the accompanying audio snippet' : ''}. 
      Determine the work context and categorize the activity precisely.
      
      Categories:
      - "Coding": IDEs, text editors, terminal, code documentation.
      - "Study": Reading documentation, research papers, educational articles.
      - "Training": Watching training videos, tutorials, webinars.
      - "Meeting": Video calls, calendar apps, collaboration tools.
      - "Work": General productive work, emails, spreadsheets.
      - "Idle": Desktop background, lock screen, no activity.
      - "Other": Social media, entertainment, unrelated content.

      Return a JSON object with:
      - summary: Short description of activity (max 15 words).
      - category: One of the categories listed above.
      - riskLevel: "low" (working), "medium" (distracted), "high" (inappropriate/unsafe).`
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            category: { type: Type.STRING },
            riskLevel: { type: Type.STRING, enum: ["low", "medium", "high"] }
          }
        }
      }
    });

    if (response.text) {
        return JSON.parse(response.text) as AnalysisResult;
    }
    
    throw new Error("No response text");

  } catch (error) {
    console.error("Gemini Analysis Failed:", error);
    // Return a safe fallback so the UI doesn't crash
    return {
      summary: "AI analysis temporarily unavailable.",
      category: "Work",
      riskLevel: "low"
    };
  }
};