const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const csvParse = require('csv-parse/sync');

const systemPrompt = `
You are an advanced AI model specialized in soccer match prediction and analysis. You are more accurate and sophisticated than a basic researcher. Your predictions are based on deep pattern recognition, statistical modeling, and comprehensive data analysis.

CRITICAL INSTRUCTIONS:
1. **ADVANCED ANALYSIS**: Use sophisticated analytical techniques to identify patterns, correlations, and trends in the dataset that may not be immediately obvious.

2. **PREDICTIVE MODELING**: Apply statistical principles and predictive modeling approaches:
   - Identify key variables and their relationships
   - Consider temporal patterns (time-based trends)
   - Analyze location-based performance metrics
   - Factor in opponent-specific characteristics
   - Consider game phase dynamics

3. **INTELLIGENT INFERENCE**: 
   - When exact matches don't exist, use advanced pattern matching:
     * Location similarity (e.g., "left wing" matches "Left Wing", "left side", similar field positions)
     * Time-based patterns (e.g., 55th minute → analyze 50-60 minute range, consider game phase)
     * Opponent analysis (use team-specific metrics or overall averages when appropriate)
   - Combine multiple data points using weighted averages or statistical methods
   - Consider contextual factors (play context, game phase, match situation)

4. **USE ACTUAL DATA**: Base predictions on:
   - Actual xG values from similar plays
   - Location-based statistics and averages
   - Time-based performance patterns
   - Team-specific metrics when available
   - Historical trends and correlations

5. **MODEL-BASED PREDICTION**: As an AI model, you should:
   - Provide precise numerical predictions (e.g., "0.45 xG" not "around 0.4-0.5")
   - Explain the statistical reasoning behind your prediction
   - Cite specific data points and patterns that support your analysis
   - Acknowledge confidence levels and uncertainty ranges
   - Use technical but accessible language

6. **ANSWER FORMAT**: Structure your response as:

**Query:** [Restate the user's question]

**Model Analysis:**
- Data patterns identified: [Describe key patterns found]
- Statistical approach: [Explain your analytical method]
- Relevant data points: [List specific examples with Game ID, Opponent, Minute, Location, xG]

**AI Model Prediction:**
[Provide your precise prediction with numerical values and statistical reasoning]

**Supporting Evidence:**
[Cite specific examples, statistics, and patterns that support your prediction]
[If you do decide to mention games, Don't mention the Game ID, just summarize the evidence in prose form. Do not cite Game IDs. Do not include Game IDs in responses. Include only relevant information about the game, such as opponents, date, season, and general context. Avoid citing specific Game IDs.]
[I don't want to see answers like this: "Since the actual data will be pulled dynamically, specific examples cannot be listed here, but the query targets the extraction of data like (Game ID: XXX, Opponent: Team Y, Minute: 7, Location: Left side of the box, xG: 0.12) etc."]
[Please DONT MENTION GAME IDS IN YOUR RESPONSES. DO NOT INCLUDE GAME IDS. JUST SUMMARIZE THE EVIDENCE IN PROSE FORM.]

**Confidence & Model Insights:**
[Explain confidence level, uncertainty range, and any model-derived insights]

REMEMBER: You are an AI model - provide precise, data-driven predictions with clear statistical reasoning. Use pattern recognition and advanced analysis, not just simple lookups.
`;

async function getModelPrediction(req, res) {
  try {
    console.log('Model prediction API called');
    console.log('Request body:', req.body);
    const { query } = req.body;

    if (!query || query.trim() === '') {
      console.error('No query provided in request');
      return res.status(400).json({ error: 'Query is required' });
    }
    
    console.log('Processing query:', query);

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
      return Object.values(row).some(val => String(val).toLowerCase().includes(queryLower));
    });

    // Format up to 5 relevant rows for the prompt
    let relevantDataText = '';
    if (relevantRows.length > 0) {
      relevantDataText = 'Relevant match data rows:\n';
      relevantRows.slice(0, 5).forEach(row => {
        relevantDataText += `- Opponent: ${row['Opponent']}, Minute: ${row['Minute']}, Play Type: ${row['Play Type']}, Shot Attempt: ${row['Shot Attempt']}, Shot Outcome: ${row['Shot Outcome']}, xG: ${row['xG']}, Location: ${row['Location on Field']}, Outcome: ${row['Outcome']}\n`;
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

Use this data to answer the user's query with advanced AI model analysis.

${relevantDataText}`;

    // Combine system prompt and data summary with user query
    const fullPrompt = `${systemPrompt}\n\n${dataSummary}\n\nUser Query: ${query}`;

    // Try different model names in order of preference
    const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-pro', 'gemini-1.0-pro'];
    let lastError;
    
    // Try each model until one works
    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        
        // Call Gemini API
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
    console.error('Error generating model prediction:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to generate prediction';
    let errorDetails = error.message || 'Unknown error occurred';
    let statusCode = 500;
    
    // Check error message (case insensitive)
    const errorMsgLower = (error.message || '').toLowerCase();
    
    // Check for Gemini API errors
    if (errorMsgLower.includes('api key') || errorMsgLower.includes('invalid api key') || errorMsgLower.includes('authentication')) {
      errorMessage = 'Gemini API key error';
      errorDetails = 'Invalid or missing API key. Please check your .env file and ensure GEMINI_API_KEY is set correctly.';
    } else if (errorMsgLower.includes('quota') || errorMsgLower.includes('exceeded')) {
      errorMessage = 'Gemini Quota Exceeded';
      errorDetails = 'You have exceeded your Gemini API quota. Please check your billing and plan details at https://makersuite.google.com/app/apikey.';
      statusCode = 429;
    } else if (errorMsgLower.includes('rate limit') || errorMsgLower.includes('429') || error.status === 429) {
      errorMessage = 'Rate Limit Exceeded';
      errorDetails = 'Too many requests. Please try again in a few moments.';
      statusCode = 429;
    } else if (errorMsgLower.includes('model') || errorMsgLower.includes('not found') || errorMsgLower.includes('not available') || errorMsgLower.includes('404')) {
      errorMessage = 'Model error';
      errorDetails = `The selected model is not available for your API key. Error: ${error.message}\n\nPossible solutions:\n1. Check your API key has access to Gemini models at https://makersuite.google.com/app/apikey\n2. Try using a different API key\n3. The model may require a different API version or billing plan\n4. Common model names: 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-pro', 'gemini-1.0-pro'`;
    } else if (errorMsgLower.includes('permission') || errorMsgLower.includes('forbidden') || error.status === 403) {
      errorMessage = 'Permission Denied';
      errorDetails = 'Your API key does not have permission to access this resource. Please check your API key permissions.';
      statusCode = 403;
    } else if (errorMsgLower.includes('network') || errorMsgLower.includes('timeout') || errorMsgLower.includes('connection')) {
      errorMessage = 'Network Error';
      errorDetails = 'Failed to connect to Gemini API. Please check your internet connection and try again.';
    }
    
    res.status(statusCode).json({ error: errorMessage, details: errorDetails });
  }
}

module.exports = { getModelPrediction };
