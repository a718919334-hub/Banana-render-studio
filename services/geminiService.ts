import { GoogleGenAI } from "@google/genai";

// Initialize the Google GenAI client
// API Key is injected via environment variable as per system instructions
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface GenerationConfig {
  prompt: string;
  referenceImage: string; // Base64 string
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  fov?: number;
  cameraInfo?: string;
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
 * Analyzes the scene screenshot and suggests 3 creative prompts.
 * Uses Gemini 3 Flash multimodal capabilities.
 */
export const analyzeSceneAndSuggestPrompts = async (imageBase64: string): Promise<string[]> => {
  const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: cleanBase64
            }
          },
          {
            text: `Analyze this 3D scene composition, geometry, and lighting. 
            Generate 3 distinct, high-quality rendering prompts that would transform this basic viewport capture into a stunning final image.
            
            Vary the art styles significantly (e.g., "Cinematic Photorealism", "Stylized/Clay", "Sci-Fi/Cyberpunk", "Watercolor/Painterly").
            Keep each prompt concise (under 25 words) but descriptive.
            
            Return ONLY a JSON array of strings, e.g. ["Prompt 1...", "Prompt 2...", "Prompt 3..."].`
          }
        ]
      },
      config: {
        responseMimeType: "application/json"
      }
    });
    
    const text = response.text;
    if (!text) return [];
    
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    // Fallback prompts if API fails
    return [
        "Cinematic studio lighting, 8k resolution, photorealistic textures, depth of field",
        "Stylized clay render, soft shadows, pastel color palette, playful atmosphere", 
        "Cyberpunk neon aesthetic, dark moody lighting, futuristic materials, volumetric fog"
    ];
  }
};

/**
 * Generates a refined image based on a 3D viewport screenshot and a text prompt
 * using the 'gemini-2.5-flash-image' model (Nano Banana).
 */
export const generateRefinedImage = async (config: GenerationConfig): Promise<string> => {
  const { prompt, referenceImage, aspectRatio = "1:1", fov, cameraInfo } = config;

  // Clean the base64 string (remove data URI prefix if present)
  const cleanBase64 = referenceImage.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

  // Construct a more detailed prompt using Camera info
  let fullPrompt = prompt || "High quality 3D render, photorealistic, 8k resolution, detailed texture, cinematic lighting.";
  
  // ADDED: Default Consistency and Optimization Instructions
  fullPrompt += `\n\n[CONSISTENCY]: Strictly maintain the main subject's geometry, pose, and structural integrity from the reference image. Do not add, remove, or distort major objects.`;
  fullPrompt += `\n[OPTIMIZATION]: Analyze the scene's composition and apply optimal lighting, shadows, and high-fidelity material textures to enhance realism and visual impact based on the scene context.`;

  // STRONG INSTRUCTION: Explicitly tell Gemini to adhere to the spatial context
  if (cameraInfo || fov) {
      fullPrompt += `\n\n[SPATIAL CONSTRAINT]: The provided reference image is a view from a virtual camera. You MUST maintain this exact perspective and composition.`;
      
      if (fov) fullPrompt += ` Camera FOV is ${fov.toFixed(0)} degrees.`;
      if (cameraInfo) fullPrompt += ` Camera Transform: ${cameraInfo}.`;
      
      fullPrompt += ` Do not change the camera angle. Apply the style and details while keeping the geometry aligned with this view.`;
  }

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
            text: fullPrompt
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
    
    // Removing potentially circular JSON dump to prevent stack overflow errors
    console.debug("Gemini Candidate received without image data.");

    throw new Error(errorMessage);

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(error.message || "Image generation failed.");
  }
};