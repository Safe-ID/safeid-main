export const C = {
  bg: "#040C1A",
  bgCard: "#071220",
  bgHover: "#0B1A2E",
  border: "#152338",
  borderL: "#1E3554",
  primary: "#1A6FFF",
  primaryD: "#1255CC",
  secondary: "#38BDF8",
  accent: "#86EFAC",
  text: "#EEF4FF",
  muted: "#7A9DC0",
  dim: "#3A5A80",
  danger: "#F87171",
  warn: "#FCD34D",
};



// Mesmos pesos do RiskEngine do backend, com os nomes exatos das Data Classes do HIBP
export const W = {
  "Passwords": 10, "Credit cards": 10, "Credit card CVV": 10, "Bank account numbers": 10,
  "Financial transactions": 10, "Partial credit card data": 8, "Government issued IDs": 8,
  "Social security numbers": 8, "Passport numbers": 8, "Driver's licenses": 8, "Auth tokens": 8,
  "Biometric data": 8, "Security questions and answers": 8, "Password hints": 7,
  "Phone numbers": 5, "Physical addresses": 5, "Dates of birth": 4,
  "Usernames": 3, "Names": 3, "Email addresses": 2, "IP addresses": 2, "Geographic locations": 2,
  "User agent details": 1, "Browser user agent details": 1, "Device information": 1,
};

// Classes completas por gravidade. O Tailwind só gera classes que aparecem
// escritas por inteiro no código, então elas não podem ser montadas com `bg-${cor}`.
export const SEVERITY_CLASSES = {
  danger: {
    chip: "bg-safe-danger/10 border-safe-danger/30 text-safe-danger",
    softChip: "bg-safe-danger/10 border-safe-danger/20 text-safe-danger",
    dot: "bg-safe-danger shadow-safe-danger/50",
  },
  warn: {
    chip: "bg-safe-warn/10 border-safe-warn/30 text-safe-warn",
    softChip: "bg-safe-warn/10 border-safe-warn/20 text-safe-warn",
    dot: "bg-safe-warn shadow-safe-warn/50",
  },
  secondary: {
    chip: "bg-safe-secondary/10 border-safe-secondary/30 text-safe-secondary",
    softChip: "bg-safe-secondary/10 border-safe-secondary/20 text-safe-secondary",
    dot: "bg-safe-secondary shadow-safe-secondary/50",
  },
};

export function severityFromWeight(weight) {
  if (weight >= 8) return SEVERITY_CLASSES.danger;
  if (weight >= 5) return SEVERITY_CLASSES.warn;
  return SEVERITY_CLASSES.secondary;
}

export const DATA_CLASS_TRANSLATIONS = {
  "Account balances": "Saldos de conta",
  "Address book contacts": "Contatos da agenda",
  "Age groups": "Faixas etárias",
  "Ages": "Idades",
  "AI prompts": "Prompts de IA",
  "Appointments": "Compromissos",
  "Apps installed on devices": "Aplicativos instalados nos dispositivos",
  "Astrological signs": "Signos astrológicos",
  "Audio recordings": "Gravações de áudio",
  "Auth tokens": "Tokens de autenticação",
  "Avatars": "Avatares",
  "Bank account numbers": "Números de conta bancária",
  "Beauty ratings": "Avaliações de aparência",
  "Biometric data": "Dados biométricos",
  "Bios": "Biografias",
  "Browser user agent details": "Detalhes do user agent do navegador",
  "Browsing histories": "Históricos de navegação",
  "Buying preferences": "Preferências de compra",
  "Car ownership statuses": "Status de propriedade de carro",
  "Career levels": "Níveis de carreira",
  "Cellular network names": "Nomes de redes móveis",
  "Charitable donations": "Doações beneficentes",
  "Chat logs": "Registros de chat",
  "Citizenship statuses": "Status de cidadania",
  "Clothing sizes": "Tamanhos de roupa",
  "Comments": "Comentários",
  "Company names": "Nomes de empresas",
  "Credit card CVV": "CVV do cartão de crédito",
  "Credit cards": "Cartões de crédito",
  "Credit scores": "Scores de crédito",
  "Credit status information": "Informações de status de crédito",
  "Cryptocurrency wallet addresses": "Endereços de carteiras de criptomoedas",
  "Customer feedback": "Feedback de clientes",
  "Customer interactions": "Interações com clientes",
  "Customer service comments": "Comentários do atendimento ao cliente",
  "Dates of birth": "Datas de nascimento",
  "Deceased date": "Data de falecimento",
  "Deceased statuses": "Status de falecimento",
  "Delivery instructions": "Instruções de entrega",
  "Device information": "Informações do dispositivo",
  "Device serial numbers": "Números de série de dispositivos",
  "Device usage tracking data": "Dados de rastreamento de uso do dispositivo",
  "Display names": "Nomes de exibição",
  "Drinking habits": "Hábitos de consumo de bebida",
  "Driver's licenses": "Carteiras de motorista",
  "Drug habits": "Hábitos de uso de drogas",
  "Earnings": "Ganhos",
  "Eating habits": "Hábitos alimentares",
  "Education levels": "Níveis de escolaridade",
  "Email addresses": "Endereços de e-mail",
  "Email messages": "Mensagens de e-mail",
  "Employers": "Empregadores",
  "Employment statuses": "Status de emprego",
  "Encrypted keys": "Chaves criptografadas",
  "Ethnicities": "Etnicidades",
  "Family members' names": "Nomes de familiares",
  "Family plans": "Planos familiares",
  "Family structure": "Estrutura familiar",
  "Financial investments": "Investimentos financeiros",
  "Financial transactions": "Transações financeiras",
  "Fitness levels": "Níveis de condicionamento físico",
  "Flights taken": "Voos realizados",
  "Forum posts": "Publicações em fóruns",
  "Genders": "Gêneros",
  "Geographic locations": "Localizações geográficas",
  "Government issued IDs": "Documentos emitidos pelo governo",
  "Health insurance information": "Informações de seguro saúde",
  "Historical passwords": "Senhas antigas",
  "HIV statuses": "Status de HIV",
  "Home ownership statuses": "Status de propriedade de imóvel",
  "Homepage URLs": "URLs da página inicial",
  "IMEI numbers": "Números IMEI",
  "IMSI numbers": "Números IMSI",
  "Income levels": "Níveis de renda",
  "Instant messenger identities": "Identidades de mensageiros instantâneos",
  "IP addresses": "Endereços IP",
  "IQ levels": "Níveis de QI",
  "Job applications": "Candidaturas de emprego",
  "Job titles": "Cargos",
  "Language preferences": "Preferências de idioma",
  "Latitude and longitude pairs": "Pares de latitude e longitude",
  "Licence plates": "Placas de veículos",
  "Living costs": "Custos de vida",
  "Loan information": "Informações de empréstimo",
  "Login histories": "Históricos de login",
  "Loyalty program details": "Detalhes de programas de fidelidade",
  "MAC addresses": "Endereços MAC",
  "Marital statuses": "Status civil",
  "Military service": "Serviço militar",
  "Mnemonic phrases": "Frases mnemônicas",
  "Mothers maiden names": "Nomes de solteira das mães",
  "Names": "Nomes",
  "Nationalities": "Nacionalidades",
  "Net worths": "Patrimônios líquidos",
  "Nicknames": "Apelidos",
  "Occupations": "Ocupações",
  "Parenting plans": "Planos parentais",
  "Partial credit card data": "Dados parciais de cartão de crédito",
  "Partial dates of birth": "Datas de nascimento parciais",
  "Partial government issued IDs": "Documentos emitidos pelo governo parcialmente expostos",
  "Partial phone numbers": "Números de telefone parciais",
  "Passport numbers": "Números de passaporte",
  "Password hints": "Dicas de senha",
  "Password strengths": "Força das senhas",
  "Passwords": "Senhas",
  "Payment histories": "Históricos de pagamento",
  "Payment methods": "Métodos de pagamento",
  "Personal descriptions": "Descrições pessoais",
  "Personal health data": "Dados pessoais de saúde",
  "Personal interests": "Interesses pessoais",
  "Phone numbers": "Números de telefone",
  "Photos": "Fotos",
  "Physical addresses": "Endereços físicos",
  "Physical attributes": "Atributos físicos",
  "PINs": "PINs",
  "Places of birth": "Locais de nascimento",
  "Political donations": "Doações políticas",
  "Political views": "Posições políticas",
  "Private messages": "Mensagens privadas",
  "Professional skills": "Habilidades profissionais",
  "Profile photos": "Fotos de perfil",
  "Profile statistics": "Estatísticas de perfil",
  "Purchases": "Compras",
  "Purchasing habits": "Hábitos de compra",
  "Races": "Raças",
  "Recovery email addresses": "E-mails de recuperação",
  "Relationship statuses": "Status de relacionamento",
  "Religions": "Religiões",
  "Reward program balances": "Saldos de programas de recompensas",
  "Salutations": "Tratamentos",
  "School grades (class levels)": "Séries escolares (níveis de classe)",
  "Security questions and answers": "Perguntas e respostas de segurança",
  "Sexual fetishes": "Fetiches sexuais",
  "Sexual orientations": "Orientações sexuais",
  "Shipment tracking numbers": "Números de rastreamento de remessa",
  "Smoking habits": "Hábitos de fumar",
  "SMS messages": "Mensagens SMS",
  "Social connections": "Conexões sociais",
  "Social media profiles": "Perfis de redes sociais",
  "Social security numbers": "Números de seguridade social",
  "Socioeconomic levels": "Níveis socioeconômicos",
  "Spoken languages": "Idiomas falados",
  "Spouses names": "Nomes de cônjuges",
  "Support tickets": "Chamados de suporte",
  "Survey results": "Resultados de pesquisas",
  "Tattoo status": "Status de tatuagem",
  "Taxation records": "Registros fiscais",
  "Telecommunications carrier": "Operadora de telecomunicações",
  "Time zones": "Fusos horários",
  "Travel habits": "Hábitos de viagem",
  "Travel plans": "Planos de viagem",
  "User statuses": "Status de usuário",
  "User website URLs": "URLs de sites do usuário",
  "Usernames": "Nomes de usuário",
  "Utility bills": "Contas de serviços públicos",
  "Vehicle details": "Detalhes do veículo",
  "Vehicle identification numbers (VINs)": "Números de identificação veicular (VINs)",
  "Vehicle registration plates": "Placas de registro de veículo",
  "VIP statuses": "Status VIP",
  "Warranty claims": "Solicitações de garantia",
  "Website activity": "Atividade em sites",
  "Work habits": "Hábitos de trabalho",
  "Years of professional experience": "Anos de experiência profissional",
};

export function translateDataClass(value) {
  return DATA_CLASS_TRANSLATIONS[value] || value;
}

// Faixas do RiskEngine em português (a API devolve LOW, MODERATE, HIGH, CRITICAL)
export const CLASSIFICATION_LABELS = { LOW: "Baixo", MODERATE: "Médio", HIGH: "Alto", CRITICAL: "Crítico" };

export function classificationLabel(value) {
  return CLASSIFICATION_LABELS[value] || value;
}

/** "1 vazamento", "3 vazamentos" */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function score(bs) {
  if (!bs.length) return 0;
  let t = 0;
  bs.forEach(b => { t += Math.max(...b.classes.map(c => W[c] || 2)); });
  const raw = (t / bs.length / 10) * 100;
  const bonus = bs.some(b => new Date(b.date).getFullYear() >= 2022) ? 10 : 0;
  return Math.min(Math.round(raw + bonus), 100);
}

// Parceira indicada no plano de ação para suporte especializado de segurança
export const ENETSEC = {
  websiteUrl: "https://enetsec.com/",
  whatsappUrl:
    "https://wa.me/19546187140?text=Ol%C3%A1%2C%20acessei%20o%20app%20SafeID%20e%20gostaria%20de%20saber%20mais%20sobre%20seus%20servi%C3%A7os.",
  messageWithBreaches:
    "Para suporte especializado de segurança, auditoria completa e proteção avançada contra ameaças digitais, entre em contato com nossa parceira ENETSEC.",
  messageWithoutBreaches:
    "A prevenção é o melhor caminho para a segurança digital. Conheça as soluções de proteção da ENETSEC.",
};
