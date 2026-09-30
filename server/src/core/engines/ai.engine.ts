/**
 * AIEngine - Motor de Inteligência Cognitiva
 * Transforma análise estruturada em orientações semânticas.
 * Usa Grok Fast (grok-4-20-non-reasoning) via Azure AI Foundry com o SDK da OpenAI.
 * O modelo e o timeout podem ser trocados pelas variáveis AI_MODEL e AI_TIMEOUT_MS.
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

export interface AIRecommendation {
  executive_summary: string;
  mitigation_steps: string[];
  urgency_level: string;
  source?: 'ai' | 'fallback'; // Indica se veio do modelo ou da resposta padrão
}

type RiskClassification = 'LOW' | 'MODERATE' | 'CRITICAL';

const URGENCY_LEVELS = ['HIGH', 'MEDIUM', 'LOW'];

const DEFAULT_MODEL = 'grok-4-20-non-reasoning';
const DEFAULT_TIMEOUT_MS = 10000;

// Tradução das Data Classes do HIBP usada na resposta padrão (chaves em minúsculas)
const DATA_CLASS_LABELS: Record<string, string> = {
  'passwords': 'senhas',
  'password hints': 'dicas de senha',
  'email addresses': 'e-mails',
  'emails': 'e-mails',
  'usernames': 'nomes de usuário',
  'names': 'nomes',
  'phone numbers': 'telefones',
  'physical addresses': 'endereços',
  'dates of birth': 'datas de nascimento',
  'date of birth': 'datas de nascimento',
  'ip addresses': 'endereços IP',
  'credit cards': 'cartões de crédito',
  'partial credit card data': 'dados parciais de cartão',
  'banking information': 'dados bancários',
  'bank account numbers': 'dados bancários',
  'social security numbers': 'números de documento',
  'government issued ids': 'documentos oficiais',
  'passport numbers': 'números de passaporte',
  'genders': 'gênero',
  'job titles': 'cargos',
  'employers': 'empregadores',
  'geographic locations': 'localização',
};

// Instruções fixas do especialista: papel, público, regras de conteúdo e formato de saída
const SYSTEM_PROMPT = `Você é o assistente de segurança do SafeID, um serviço brasileiro que avisa pessoas comuns quando o e-mail delas aparece em vazamentos de dados. Você atua como um especialista em cibersegurança e proteção de dados pessoais (LGPD) explicando a situação para alguém sem conhecimento técnico.

OBJETIVO
Transformar a lista de vazamentos recebida em um relatório curto, claro e acionável, que ajude a pessoa a entender o risco real e a saber exatamente o que fazer agora.

COMO ANALISAR
1. Priorize pelos dados expostos, do mais grave para o menos grave:
   - Crítico: senhas, dados bancários, cartões de crédito, documentos de identificação (CPF, RG, passaporte, número de seguro social).
   - Alto: telefone, endereço físico, data de nascimento.
   - Moderado: nome, empregador, cargo.
   - Baixo: e-mail, nome de usuário, endereço IP.
2. Considere a data: vazamentos com menos de 1 ano são os mais urgentes, porque a senha provavelmente ainda está em uso. Vazamentos antigos ainda importam se a pessoa reutiliza senhas.
3. Vazamentos marcados como "não verificado" têm menor confiança: mencione a possibilidade, sem alarmismo.
4. Relacione cada ação a um risco concreto:
   - Senha exposta: trocar a senha no serviço afetado e em qualquer outro onde ela tenha sido reutilizada; ativar verificação em duas etapas.
   - Telefone exposto: atenção a golpes por SMS e WhatsApp (falso parente, falsa central do banco) e risco de clonagem de chip (SIM swap).
   - E-mail ou nome expostos: atenção a phishing personalizado que usa o nome do serviço vazado.
   - Dados bancários ou cartões: avisar o banco, bloquear ou trocar o cartão, acompanhar o extrato.
   - Documentos, endereço ou data de nascimento: consultar o Registrato do Banco Central e ativar alertas de uso do CPF para detectar contas ou empréstimos abertos em seu nome.
5. Recomende um gerenciador de senhas quando houver senha exposta em mais de um serviço ou suspeita de reutilização.

ESTILO
- Português do Brasil, tom calmo, direto e empático. Fale diretamente com a pessoa ("você").
- Sem jargão técnico. Se um termo for inevitável, explique em poucas palavras.
- Não invente fatos: use somente os vazamentos e dados informados. Não afirme que houve fraude ou invasão da conta.
- Cite os serviços pelo nome.
- Nunca peça senhas, códigos ou dados pessoais, e nunca indique links para clicar.

FORMATO DA RESPOSTA
Responda somente com um objeto JSON válido, sem markdown e sem texto fora do JSON, com exatamente estes campos:
{
  "executive_summary": "Resumo de 2 a 3 frases (no máximo 450 caracteres). Deve dizer quantos vazamentos foram encontrados, quais dados mais graves foram expostos e em quais serviços, e terminar com a ação mais importante a fazer agora. Precisa fazer sentido sozinho, pois é o texto exibido no painel do usuário.",
  "mitigation_steps": ["De 4 a 6 passos, ordenados do mais urgente para o menos urgente. Cada passo começa com um verbo no imperativo, cabe em uma frase e é específico para os dados expostos."],
  "urgency_level": "HIGH, MEDIUM ou LOW"
}

CRITÉRIO DE URGÊNCIA
- HIGH: classificação CRITICAL, ou senha, dado bancário, cartão ou documento exposto em vazamento com menos de 1 ano.
- MEDIUM: classificação MODERATE, ou dados sensíveis expostos apenas em vazamentos antigos.
- LOW: classificação LOW e apenas dados de baixa sensibilidade expostos.`;

export class AIEngine {
  private openaiClient: OpenAI | null = null;

  private readonly endpoint: string;
  private readonly modelName: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string) {
    // Puxa o endpoint limpo diretamente do .env
    const envEndpoint = process.env.AI_ENDPOINT || '';

    // Limpa espaços e barras no final para evitar erros de concatenação
    this.endpoint = envEndpoint.trim().replace(/\/$/, '');
    this.modelName = (process.env.AI_MODEL || '').trim() || DEFAULT_MODEL;

    const envTimeout = Number(process.env.AI_TIMEOUT_MS);
    this.timeoutMs = envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS;

    if (!this.endpoint) {
      console.warn('[AIEngine] Aviso: Variável de ambiente AI_ENDPOINT não está definida.');
    }

    const key = (apiKey || '').trim();

    if (key && this.endpoint) {
      // Instanciação limpa, sem defaultQuery ou defaultHeaders.
      // Sem retries: se o modelo não responder a tempo, o scan segue com a resposta padrão.
      this.openaiClient = new OpenAI({
        baseURL: this.endpoint,
        apiKey: key,
        timeout: this.timeoutMs,
        maxRetries: 0,
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
    classification?: RiskClassification;
  }): Promise<AIRecommendation> {
    if (!this.openaiClient) {
      console.warn('[AIEngine] Cliente de IA não configurado, usando resposta padrão.');
      return this.buildFallbackRecommendation(context);
    }

    const prompt = this.buildSafePrompt(context);
    const startedAt = Date.now();

    try {
      const completion = await this.openaiClient.chat.completions.create({
        model: this.modelName,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        // Temperatura baixa para respostas consistentes entre scans parecidos
        temperature: 0.3,
        // Garante o retorno estrito em formato JSON
        response_format: { type: 'json_object' }
      });

      const textContent = completion.choices[0]?.message?.content;

      if (!textContent) throw new Error('Empty response from model');

      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : textContent;
      const recommendation = this.validateRecommendation(JSON.parse(jsonStr));
      console.log(`[AIEngine] Recomendação gerada pelo modelo ${this.modelName} em ${Date.now() - startedAt}ms`);
      return { ...recommendation, source: 'ai' };

    } catch (error) {
      console.error(`[AIEngine] Falha no modelo ${this.modelName} após ${Date.now() - startedAt}ms, usando resposta padrão:`, error);
      return this.buildFallbackRecommendation(context);
    }
  }

  /**
   * Garante que a resposta do modelo segue o contrato esperado pelo scan
   */
  private validateRecommendation(data: any): AIRecommendation {
    const summary = typeof data?.executive_summary === 'string' ? data.executive_summary.trim() : '';
    const steps = Array.isArray(data?.mitigation_steps)
      ? data.mitigation_steps.filter((step: unknown) => typeof step === 'string' && step.trim())
      : [];
    const urgency = typeof data?.urgency_level === 'string' ? data.urgency_level.toUpperCase() : '';

    if (!summary || steps.length === 0 || !URGENCY_LEVELS.includes(urgency)) {
      throw new Error('Invalid recommendation format from model');
    }

    return {
      executive_summary: summary,
      mitigation_steps: steps,
      urgency_level: urgency,
    };
  }

  /**
   * Resposta padrão usada quando o modelo não está disponível.
   * Os passos dependem dos tipos de dado expostos.
   */
  private buildFallbackRecommendation(context: {
    breaches: HIBPBreach[];
    riskScore: number;
    classification?: RiskClassification;
  }): AIRecommendation {
    const breachNames = context.breaches.map(b => b.Name).join(', ') || 'serviço não identificado';
    const allDataTypes = Array.from(
      new Set(context.breaches.flatMap(b => b.DataClasses || []))
    );
    const exposed = new Set(allDataTypes.map(dataType => dataType.toLowerCase()));
    const hasAny = (...dataTypes: string[]) => dataTypes.some(dataType => exposed.has(dataType));

    const dataTypesStr = allDataTypes.length > 0
      ? Array.from(new Set(allDataTypes.map(dataType => this.translateDataClass(dataType)))).join(', ')
      : 'dados não especificados';

    const hasPasswords = hasAny('passwords', 'password hints');
    const steps: string[] = [];

    if (hasPasswords) {
      steps.push('Troque a senha dos serviços afetados e de qualquer outro serviço onde você usa a mesma senha.');
    }
    if (hasAny('credit cards', 'partial credit card data', 'banking information', 'bank account numbers')) {
      steps.push('Avise seu banco, peça a troca do cartão e acompanhe o extrato nos próximos meses.');
    }
    if (hasAny('social security numbers', 'government issued ids', 'passport numbers', 'dates of birth', 'date of birth', 'physical addresses')) {
      steps.push('Consulte o Registrato do Banco Central e ative alertas de uso do seu CPF para identificar contas ou empréstimos abertos em seu nome.');
    }
    if (hasAny('phone numbers')) {
      steps.push('Desconfie de mensagens por SMS e WhatsApp pedindo dinheiro ou códigos, mesmo que pareçam vir de conhecidos ou do banco.');
    }
    steps.push('Ative a verificação em duas etapas nas contas principais, como e-mail, banco e redes sociais.');
    steps.push('Desconfie de e-mails que citem os serviços vazados e não clique em links pedindo para confirmar seus dados.');

    const firstAction = hasPasswords
      ? 'Troque sua senha nos serviços afetados'
      : 'Ative a verificação em duas etapas';

    return {
      executive_summary:
        `Encontramos ${context.breaches.length} vazamento(s) com seus dados em: ${breachNames}, envolvendo ${dataTypesStr}. ${firstAction} e revise suas contas conectadas.`,
      mitigation_steps: steps,
      urgency_level: this.resolveFallbackUrgency(context),
      source: 'fallback',
    };
  }

  /**
   * Urgência da resposta padrão, alinhada às faixas do RiskEngine (71+ CRITICAL, 31+ MODERATE)
   */
  private resolveFallbackUrgency(context: {
    riskScore: number;
    classification?: RiskClassification;
  }): string {
    const classification = context.classification
      ?? (context.riskScore >= 71 ? 'CRITICAL' : context.riskScore >= 31 ? 'MODERATE' : 'LOW');

    if (classification === 'CRITICAL') return 'HIGH';
    if (classification === 'MODERATE') return 'MEDIUM';
    return 'LOW';
  }

  private translateDataClass(dataClass: string): string {
    return DATA_CLASS_LABELS[dataClass.toLowerCase()] || dataClass;
  }

  /**
   * Monta a mensagem com os dados do scan.
   * Usa somente campos públicos do vazamento (nome, data, tipos de dado, verificação).
   */
  private buildSafePrompt(context: {
    breaches: HIBPBreach[];
    riskScore: number;
    classification?: RiskClassification;
  }): string {
    const breachesInfo = [...context.breaches]
      .sort((a, b) => this.calculateDaysAgo(a.BreachDate) - this.calculateDaysAgo(b.BreachDate))
      .map((breach) => {
        const dataTypes = breach.DataClasses?.join(', ') || 'não informado';
        const daysAgo = this.calculateDaysAgo(breach.BreachDate);
        const timeframe = daysAgo > 365
          ? `há mais de ${Math.floor(daysAgo / 365)} ano(s)`
          : daysAgo > 0
          ? `há ${daysAgo} dias`
          : 'recentemente';
        const verification = breach.IsVerified ? 'verificado' : 'não verificado';
        return `- ${breach.Name} | ocorreu ${timeframe} | ${verification} | dados expostos: ${dataTypes}`;
      })
      .join('\n');

    const classificationLine = context.classification
      ? `\nClassificação de risco: ${context.classification}`
      : '';

    return `Resultado do scan de vazamentos do usuário:

Vazamentos encontrados (${context.breaches.length}), do mais recente para o mais antigo:
${breachesInfo}

Pontuação de risco: ${context.riskScore}/100${classificationLine}

Gere o relatório seguindo as instruções e responda somente com o JSON.`;
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