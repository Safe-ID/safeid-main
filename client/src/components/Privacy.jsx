const SECTIONS = [
  {
    title: "1. Quem somos",
    body: [
      "O SafeID é um projeto acadêmico, desenvolvido como Trabalho de Conclusão de Curso do curso de Tecnologia em Análise e Desenvolvimento de Sistemas do IFSP São Paulo (2026). A equipe do projeto é responsável pelo tratamento dos dados descritos aqui.",
    ],
  },
  {
    title: "2. Quais dados coletamos",
    items: [
      "Seu email, usado para criar a conta e para consultar vazamentos.",
      "Sua senha, guardada apenas como hash (bcrypt). Nem a equipe consegue ver a senha original.",
      "O identificador da sua conta Google, se você entrar com o Google.",
      "Os resultados dos scans: nomes dos vazamentos, tipos de dado expostos, datas, score de risco e as recomendações geradas.",
      "A data em que você aceitou esta política.",
    ],
  },
  {
    title: "3. Para que usamos",
    items: [
      "Verificar se o seu email aparece em vazamentos de dados conhecidos.",
      "Calcular o score de risco e gerar o plano de ação.",
      "Manter sua conta e o histórico dos seus scans.",
    ],
    after: "O tratamento se baseia no seu consentimento e na execução do serviço que você solicitou (LGPD, art. 7º, incisos I e V).",
  },
  {
    title: "4. Com quem compartilhamos",
    items: [
      "Have I Been Pwned: recebe o seu email para consultar em quais vazamentos ele aparece.",
      "Provedor de inteligência artificial (Azure AI Foundry): recebe apenas os nomes dos vazamentos e os tipos de dado expostos, para gerar as recomendações. O seu email nunca é enviado para a IA.",
      "Google: apenas se você escolher entrar com o Google.",
      "Provedores de hospedagem, que armazenam o sistema e o banco de dados.",
    ],
    after: "Não vendemos nem compartilhamos seus dados para publicidade.",
  },
  {
    title: "5. Por quanto tempo guardamos",
    body: [
      "Seus dados ficam guardados enquanto a sua conta existir. O resultado mais recente do scan também fica em cache por até 24 horas para agilizar novas consultas, e os dados temporários de processamento são apagados automaticamente.",
      "Quando você exclui a conta, apagamos a conta e todo o histórico de scans.",
    ],
  },
  {
    title: "6. Como protegemos",
    body: [
      "Usamos hash de senha, autenticação por token com prazo de validade, limite de tentativas de login e acesso restrito ao banco de dados. No histórico de scans, o email é guardado apenas como hash.",
    ],
  },
  {
    title: "7. Seus direitos",
    items: [
      "Confirmar se tratamos seus dados e acessar o que está guardado (o painel mostra o seu resultado e o histórico).",
      "Corrigir dados incompletos ou desatualizados.",
      "Excluir seus dados e revogar o consentimento a qualquer momento, pelo botão \"Excluir conta\" no painel.",
      "Saber com quem seus dados são compartilhados (seção 4).",
    ],
    after: "Esses direitos estão no artigo 18 da LGPD (Lei nº 13.709/2018). Para qualquer outra solicitação, fale com a equipe pelo repositório do projeto no GitHub.",
  },
  {
    title: "8. Alterações nesta política",
    body: [
      "Se esta política mudar, a nova versão será publicada nesta página. Última atualização: 30 de setembro de 2026.",
    ],
  },
];

export default function Privacy({ onBack }) {
  return (
    <div className="w-full max-w-3xl mx-auto pt-10 px-6 pb-20 animate-slide-up">
      <button
        type="button"
        onClick={onBack}
        className="bg-transparent border border-safe-border rounded-lg text-safe-dim py-2 px-4 text-sm cursor-pointer transition-colors hover:bg-safe-hover hover:text-safe-muted mb-8"
      >
        ← Voltar
      </button>

      <div className="text-safe-dim text-xs font-semibold tracking-widest mb-2">LGPD</div>
      <h1 className="text-safe-text text-3xl font-bold tracking-tight font-[system-ui,sans-serif] mb-3">
        Política de Privacidade
      </h1>
      <p className="text-safe-muted text-base leading-relaxed mb-10">
        Esta página explica quais dados o SafeID coleta, para que eles são usados e como você pode controlá-los, de acordo com a Lei Geral de Proteção de Dados (LGPD).
      </p>

      <div className="flex flex-col gap-6">
        {SECTIONS.map((section) => (
          <section key={section.title} className="bg-safe-card border border-safe-border rounded-2xl p-6">
            <h2 className="text-safe-text font-semibold text-lg mb-3">{section.title}</h2>
            {section.body?.map((paragraph) => (
              <p key={paragraph} className="text-safe-muted text-sm leading-relaxed mb-2 last:mb-0">{paragraph}</p>
            ))}
            {section.items && (
              <ul className="flex flex-col gap-2 list-disc pl-5 text-safe-muted text-sm leading-relaxed">
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
            {section.after && <p className="text-safe-dim text-sm leading-relaxed mt-3">{section.after}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
