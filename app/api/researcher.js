const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const csvParse = require('csv-parse/sync');

const systemPrompt = `
You're a researcher well versed in data analytics speaking directly to another 
coach or teammate about their question and you've done research on it to come up with a conclusion. 
Your findings comes from the dataset and the plots that you've looked at.
Write naturally and confidently, as if you're making a real-world prediction after 
reviewing match data.


Keep it conversational and grounded. Use clear but professional human sentences. 
Start by restating the user's question as a research question, then give a quick, 
plain-English prediction (e.g., "I think this is a risky play" or 
"This is a smart move"). After that, explain the data that led you to that conclusion.
Don't say stuff like "Okay, so you're asking about ..." or "Here's what I'm thinking...".
Remember you're a well respected researcher so make it professional.


When you explain your reasoning:
- Highlight concrete patterns or examples from past games (give 1–3 illustrative examples).
- Call out key metrics (xG, location, minute ranges, success rates) that matter for your verdict.
- Mention any situational caveats (e.g., opponent strength, fatigue, scoreline) that could change the recommendation.

Critical instruction about listing occurrences: IF AND ONLY IF there are multiple distinct past occurrences of the exact situation the user asked about, list them as short bullet points (Game ID, opponent, minute, location). If there is only one or none, do not attempt to list multiple occurrences—just summarize the evidence.

Be human, short, and practical: give a one-sentence verdict, then a short numbered list of the supporting points.
`;

async function getResearcherResponse(req, res) {
  try {
    const { query } = req.body;

    if (!query || query.trim() === '') {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Check if API key is set
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Gemini API key not configured', details: 'Please set GEMINI_API_KEY in your .env file' });
    }

    // Initialize Gemini client
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    

    // Load and parse match_data.csv
    const csvPath = path.resolve(__dirname, '../../..', 'match_data.csv');
    let csvRows = [];
    try {
      const csvContent = fs.readFileSync(csvPath, 'utf8');
      csvRows = csvParse.parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
      });
    } catch (err) {
      console.error('Error reading match_data.csv:', err);
    }

    // Filter relevant rows based on the user's query (simple keyword match)
    const queryLower = query.toLowerCase();
    const relevantRows = csvRows.filter(row => {
      // Check if any value in the row matches the query
      return Object.values(row).some(val => String(val).toLowerCase().includes(queryLower));
    });

    // Format up to 5 relevant rows for the prompt
    let relevantDataText = '';
    if (relevantRows.length > 0) {
      relevantDataText = 'Relevant match data rows:\n';
      relevantRows.slice(0, 5).forEach(row => {
        relevantDataText += `- Game ID: ${row['Game ID']}, Opponent: ${row['Opponent']}, Minute: ${row['Minute']}, Play Type: ${row['Play Type']}, Shot Attempt: ${row['Shot Attempt']}, Shot Outcome: ${row['Shot Outcome']}, xG: ${row['xG']}, Location: ${row['Location on Field']}, Outcome: ${row['Outcome']}\n`;
      });
    } else {
      relevantDataText = 'No directly matching rows found for this query.';
    }

    // Create a summary of the data for context
    const dataSummary = `You have access to soccer match data including:
- Game information (opponents, dates, seasons)
- Play-by-play data with minutes, play types, shot attempts, outcomes
- Expected goals (xG) values
- Shot locations and distances
- Play contexts and phases of match
- Team performance metrics

Use this data to answer the user's query.

${relevantDataText}`;

    // Combine system prompt and data summary with user query
    const fullPrompt = `${systemPrompt}\n\n${dataSummary}\n\nUser Query: ${query}`;

    // Try different model names in order of preference
    // gemini-2.0-flash is the newest and fastest model
    const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-pro', 'gemini-1.0-pro'];
    let lastError;
    
    // Try each model until one works
    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        
        // Call Gemini API - this is where the actual error will occur if model is unavailable
        const result = await model.generateContent(fullPrompt);
        const response = result.response;
        const text = response.text();
        
        if (!text) {
          throw new Error('Empty response from Gemini API');
        }

        res.json({ response: text });
        return; // Success, exit function
      } catch (error) {
        lastError = error;
        const errorMsg = (error.message || '').toLowerCase();
        // If it's a model not found error, try next model
        if (errorMsg.includes('not found') || errorMsg.includes('404') || errorMsg.includes('model')) {
          console.log(`Model ${modelName} not available (${error.message}), trying next...`);
          continue; // Try next model
        }
        // For other errors (API key, quota, etc.), throw immediately
        throw error;
      }
    }
    
    // If we get here, all models failed
    throw lastError || new Error('All model attempts failed. Please check your API key has access to Gemini models.');
  } catch (error) {
    console.error('Error generating researcher response:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Try to extract more details from the error
    let errorString = '';
    try {
      errorString = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
      console.error('Full error object:', errorString);
    } catch (e) {
      console.error('Could not stringify error:', e);
    }
    
    // Provide more specific error messages
    let errorMessage = 'Failed to generate response';
    let errorDetails = error.message || 'Unknown error occurred';
    let statusCode = 500;
    
    // Check error message (case insensitive)
    const errorMsgLower = (error.message || '').toLowerCase();
    const errorStringLower = errorString.toLowerCase();
    
    res.status(statusCode).json({ error: errorMessage, details: errorDetails });
  }
}

module.exports = { getResearcherResponse };
