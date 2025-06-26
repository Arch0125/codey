"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const x402_express_1 = require("x402-express");
const facilitatorUrl = 'https://x402.org/facilitator';
const payTo = '0x421Ca3C710B57D6e156fb36AF691393259E5Dc5c';
console.log(facilitatorUrl, payTo);
if (!facilitatorUrl || !payTo) {
    console.error('Missing required environment variables');
    process.exit(1);
}
const app = (0, express_1.default)();
const port = process.env.PORT || 3001;
app.use(express_1.default.json());
app.post('/gpt', async (req, res, next) => {
    const { price } = req.body;
    if (!price) {
        return res.status(400).json({ error: 'Price required in request body.' });
    }
    // Attach a dynamic payment middleware for this request
    (0, x402_express_1.paymentMiddleware)(payTo, {
        'POST /gpt': {
            price: `$${price}`,
            network: 'base-sepolia',
        },
    }, {
        url: facilitatorUrl,
    })(req, res, next);
}, async (req, res) => {
    const { model, prompt } = req.body;
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OpenAI API key not set in environment.' });
    }
    try {
        const response = await axios_1.default.post('https://api.openai.com/v1/chat/completions', {
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
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.listen(port, () => {
    console.log(`GPT proxy server listening at http://localhost:${port}`);
});
//# sourceMappingURL=server.js.map