import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { paymentMiddleware, Resource } from 'x402-express';

const facilitatorUrl = 'https://x402.org/facilitator' as Resource;
const payTo = '0x421Ca3C710B57D6e156fb36AF691393259E5Dc5c' as `0x${string}`;

console.log(facilitatorUrl, payTo);

if (!facilitatorUrl || !payTo) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

app.post('/gpt', async (req: Request, res: Response, next: NextFunction) => {
  const { price } = req.body;
  if (!price) {
    return res.status(400).json({ error: 'Price required in request body.' });
  }
  // Attach a dynamic payment middleware for this request
  paymentMiddleware(
    payTo,
    {
      'POST /gpt': {
        price: `$${price}`,
        network: 'base-sepolia',
      },
    },
    {
      url: facilitatorUrl,
    },
  )(req, res, next);
}, async (req: Request, res: Response) => {
  const { model, prompt } = req.body;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not set in environment.' });
  }
  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model,
      messages: [
        { role: 'system', content: 'You are an expert programmer.' },
        { role: 'user', content: prompt }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(response.data);
    res.json(response.data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`GPT proxy server listening at http://localhost:${port}`);
}); 