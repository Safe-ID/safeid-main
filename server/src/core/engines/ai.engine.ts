/**
 * AIEngine - Motor de Inteligência Cognitiva
 * Transforma análise estruturada em orientações semânticas.
 * Usa Grok Fast (grok-4-20-non-reasoning) via Azure AI Foundry com o SDK da OpenAI.
 */

import OpenAI from 'openai';

interface HIBPBreach {
  Name: string;
  Title: string;
  BreachDate: string;
  DataClasses: string[];
  IsVerified: boolean;
  [key: string]: any;
}

interface AIRecommendation {
  executive_summary: string;
  mitigation_steps: string[];
  urgency_level: string;
}

export class AIEngine {
  private openaiClient: OpenAI | null = null;
  
  private readonly endpoint: string;
  private readonly modelName = 'grok-4-20-non-reasoning';

  constructor(apiKey: string) {
    // Puxa o endpoint limpo diretamente do .env
    const envEndpoint = process.env.AI_ENDPOINT || '';
    
    // Limpa espaços e barras no final para evitar erros de concatenação
    this.endpoint = envEndpoint.trim().replace(/\/$/, '');

    if (!this.endpoint) {
      console.warn('[AIEngine] Aviso: Variável de ambiente AI_ENDPOINT não está definida.');
    }

    const key = (apiKey || '').trim();
    
    if (key && this.endpoint) {
      // Instanciação limpa, sem defaultQuery ou defaultHeaders
      this.openaiClient = new OpenAI({
        baseURL: this.endpoint,
        apiKey: key,
      });
    }
  }

  /**
   * Gera recomendações baseadas em TODAS as breaches encontradas
   * NUNCA envia dados sensíveis (email) para a IA
   */
  async generateRecommendation(context: {
    breaches: HIBPBreach[];
    riskScore: number;
  }): Promise<AIRecommendation> {
    if (!this.openaiClient) {
      return this.buildFallbackRecommendation(context);
    }

    const prompt = this.buildSafePrompt(context);

    try {
      const completion = await this.openaiClient.chat.completions.create({
        model: this.modelName,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        // Garante o retorno estrito em formato JSON
        response_format: { type: 'json_object' }
      });

      const textContent = completion.choices[0]?.message?.content;
      
      if (!textContent) throw new Error('Empty response from model');

      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : textContent;
      return JSON.parse(jsonStr) as AIRecommendation;

    } catch (error) {
      console.error('AIEngine error:', error);
      return this.buildFallbackRecommendation(context);
    }
  }

  private buildFallbackRecommendation(context: {
    breaches: HIBPBreach[];
    riskScore: number;
  }): AIRecommendation {
    const breachNames = context.breaches.map(b => b.Name).join(', ') || 'Unknown';
    const allDataTypes = Array.from(
      new Set(context.breaches.flatMap(b => b.DataClasses || []))
    );
    const dataTypesStr = allDataTypes.length > 0
      ? allDataTypes.join(', ')
      : 'dados não especificados';

    return {
      executive_summary:
        `Detectamos ${context.breaches.length} possível(is) vazamento(s) em: ${breachNames}, envolvendo ${dataTypesStr}. Troque sua senha imediatamente e revise suas contas conectadas.`,
      mitigation_steps: [
        'Troque a senha afetada por uma senha única e forte.',
        'Ative autenticação de dois fatores nas contas principais.',
        'Revise atividades recentes e alertas de login em seus serviços.',
        `Acompanhe ${context.breaches.length} serviço(s) comprometido(s) para atualizações de segurança.`,
      ],
      urgency_level: context.riskScore >= 70 ? 'HIGH' : 'MEDIUM',
    };
  }

  private buildSafePrompt(context: {
    breaches: HIBPBreach[];
    riskScore: number;
  }): string {
    const breachesInfo = context.breaches
      .map((breach) => {
        const dataTypes = breach.DataClasses?.join(', ') || 'unknown';
        const daysAgo = this.calculateDaysAgo(breach.BreachDate);
        const timeframe = daysAgo > 365
          ? `há mais de ${Math.floor(daysAgo / 365)} ano(s)`
          : daysAgo > 0
          ? `há ${daysAgo} dias`
          : 'recentemente';
        return `- ${breach.Name} (${timeframe}): ${dataTypes}`;
      })
      .join('\n');

    return `You are a cybersecurity expert providing guidance to non-technical users in Portuguese.

Multiple data breaches were found:
${breachesInfo}

Overall Risk Score: ${context.riskScore}/100
Total breaches found: ${context.breaches.length}

Provide a JSON response with exactly these fields:
{
  "executive_summary": "Brief, comprehensive summary in Portuguese addressing ALL breaches (2-3 sentences)",
  "mitigation_steps": ["Step 1 in Portuguese", "Step 2 in Portuguese", "Step 3 in Portuguese", "Step 4 in Portuguese"],
  "urgency_level": "HIGH" or "MEDIUM" or "LOW"
}

Be direct, technical but accessible, and focus on immediate actions the user should take.
Response must be valid JSON only, no markdown or code blocks.`;
  }

  private calculateDaysAgo(breachDate: string): number {
    try {
      const breach = new Date(breachDate);
      const today = new Date();
      const diff = today.getTime() - breach.getTime();
      return Math.floor(diff / (1000 * 60 * 60 * 24));
    } catch {
      return 0;
    }
  }
}