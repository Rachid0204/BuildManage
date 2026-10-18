import { GoogleGenAI } from "@google/genai";
import { Language } from "../types";

// Helper to safely get API Key from either Vite env or Process env
const getApiKey = () => {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_KEY) {
        // @ts-ignore
        return import.meta.env.VITE_API_KEY;
    }
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
        // @ts-ignore
        return process.env.API_KEY;
    }
    return '';
};

const apiKey = getApiKey();
const ai = new GoogleGenAI({ apiKey });

const languageMap: Record<Language, string> = {
    en: "English",
    fr: "French",
    ar: "Arabic"
};

export const generateAnnouncementText = async (topic: string, buildingName: string, lang: Language): Promise<string> => {
    try {
        if (!apiKey) {
            console.warn("Gemini API Key is missing.");
            return "Error: API Key missing. Please configure VITE_API_KEY.";
        }

        const languageName = languageMap[lang];
        const prompt = `You are a professional building manager (syndic) in Morocco. Write a clear and concise announcement for the residents of ${buildingName}.
        The tone should be formal but friendly. The announcement should be in clear, simple language.
        
        The topic for the announcement is: "${topic}".

        The announcement must be written in ${languageName}.
        
        Generate only the content of the announcement. Do not include a title.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
        });
        
        // Return generated text
        return response.text || '';
    } catch (error) {
        console.error("Error generating text with Gemini:", error);
        return "An error occurred while generating the announcement. Please try again.";
    }
};