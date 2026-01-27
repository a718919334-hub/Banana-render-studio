import { GoogleGenAI } from "@google/genai";

// Initialize the Google GenAI client
// API Key is injected via environment variable as per system instructions
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface GenerationConfig {
  prompt: string;
  referenceImage: string; // Base64 string
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
}

/**
 * Uses Gemini 3 Flash to optimize a simple user prompt into a detailed 3D generation prompt.
 */
export const optimizePromptFor3D = async (rawPrompt: string): Promise<string> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `You are an expert 3D artist. Convert the following short user input into a detailed, comma-separated prompt suitable for a Text-to-3D AI generator. 
            Focus on geometry, style (e.g. stylized, realistic, low-poly), materials, and lighting. 
            Keep it under 40 words. 
            
            User Input: "${rawPrompt}"
            
            Output ONLY the refined prompt, no explanations.`,
        });

        const text = response.text;
        return text ? text.trim() : rawPrompt;
    } catch (e) {
        console.warn("Gemini Prompt Optimization failed, using raw prompt.", e);
        return rawPrompt;
    }
};

/**
 * Generates a refined image based on a 3D viewport screenshot and a text prompt
 * using the 'gemini-2.5-flash-image' model (Nano Banana).
 */
export const generateRefinedImage = async (config: GenerationConfig): Promise<string> => {
  const { prompt, referenceImage, aspectRatio = "1:1" } = config;

  // Clean the base64 string (remove data URI prefix if present)
  const cleanBase64 = referenceImage.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: cleanBase64
            }
          },
          {
            text: prompt || "High quality 3D render, photorealistic, 8k resolution, detailed texture, cinematic lighting."
          }
        ]
      },
      config: {
        imageConfig: {
            aspectRatio: aspectRatio
        }
      }
    });

    const candidate = response.candidates?.[0];

    // 1. Check for abnormal finish reasons (e.g., SAFETY, RECITATION)
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        console.warn(`Gemini generation stopped. Reason: ${candidate.finishReason}`);
    }

    // 2. Robust extraction of image data
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData && part.inlineData.data) {
                const mimeType = part.inlineData.mimeType || 'image/png';
                return `data:${mimeType};base64,${part.inlineData.data}`;
            }
        }
    }

    // 3. Fallback: If no image is found, check if the model returned a text explanation (e.g. refusal)
    let errorMessage = "No image data found in Gemini response.";
    if (candidate?.content?.parts) {
        const textPart = candidate.content.parts.find(p => p.text);
        if (textPart && textPart.text) {
            // Limit error message length for UI
            const reason = textPart.text.slice(0, 200); 
            errorMessage = `Generation failed: ${reason}`;
        }
    }
    
    // Log the full candidate for deep debugging if needed
    console.debug("Gemini Candidate Dump:", JSON.stringify(candidate, null, 2));

    throw new Error(errorMessage);

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(error.message || "Image generation failed.");
  }
};
