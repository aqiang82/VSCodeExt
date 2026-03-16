import fetch from 'node-fetch';
import * as vscode from 'vscode';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

export async function callDeepSeek(messages: { role: string, content: string }[]): Promise<string> {
    const apiKey = 'sk-a45f6f644bc4460a9b3461a7367caae2';//vscode.workspace.getConfiguration('flutterTools').get<String>('deepSeekApiKey');
    
    if (!apiKey) {
        vscode.window.showErrorMessage('请设置 DeepSeek API Key');
        return '';
    }
    const res = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'deepseek-coder',
            messages,
            temperature: 0.3,
            stream: false,
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`DeepSeek API Error: ${text}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
}
