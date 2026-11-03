// O mesmo texto está em TERMS.md: ao alterar um, atualize o outro e a versão em lib/legal.js
import LegalDocument from "./LegalDocument";
import { LEGAL } from "../lib/legal";

const SECTIONS = [
  {
    title: "1. O que é o SafeID",
    body: [
      "O SafeID verifica se o seu email aparece em vazamentos de dados conhecidos, calcula um score de risco, gera um plano de ação com inteligência artificial e pode avisar quando surgir um vazamento novo.",
      `É um projeto acadêmico, desenvolvido como Trabalho de Conclusão de Curso do curso de Tecnologia em Análise e Desenvolvimento de Sistemas do IFSP São Paulo (2026), e é gratuito. Responsáveis: ${LEGAL.controller}. Contato: ${LEGAL.contact}.`,
    ],
  },
  {
    title: "2. Sua conta",
    items: [
      "Você precisa ter 18 anos ou mais.",
      "Use apenas um email que seja seu: a conta só é ativada depois da confirmação por email, e a consulta usa sempre o email da conta.",
      "Guarde sua senha com cuidado. Você responde pelo que for feito na sua conta.",
    ],
  },
  {
    title: "3. O que não é permitido",
    items: [
      "Tentar consultar dados de outra pessoa ou criar contas com emails que não são seus.",
      "Atacar o serviço, burlar os limites de uso ou automatizar acessos que prejudiquem o funcionamento.",
      "Usar o SafeID para qualquer finalidade ilegal.",
    ],
    after: "Contas que descumprirem estas regras podem ser suspensas ou excluídas.",
  },
  {
    title: "4. Limites do resultado",
    items: [
      "A consulta depende das bases do Have I Been Pwned, que não incluem todos os vazamentos existentes. \"Nenhum vazamento encontrado\" não garante que os seus dados nunca foram expostos.",
      "O score de risco é uma estimativa, calculada a partir dos dados expostos e da data de cada vazamento.",
      "O plano de ação é gerado por inteligência artificial e pode conter erros. Ele é uma orientação geral, não uma consultoria profissional de segurança ou jurídica.",
    ],
  },
  {
    title: "5. Alertas por email",
    body: [
      "Se você ligar os alertas, o SafeID verifica o seu email quando a base de vazamentos é atualizada e avisa no painel e por email. O serviço faz esforços razoáveis, mas não garante que todo vazamento será detectado ou avisado a tempo. Dá para desligar no painel ou pelo link de cada alerta. Com os alertas desligados, o resultado não é atualizado sozinho.",
    ],
  },
  {
    title: "6. Serviços de terceiros",
    body: [
      "Os dados de vazamentos vêm do Have I Been Pwned (haveibeenpwned.com), sob a licença Creative Commons Attribution 4.0. O plano de ação indica a ENETSEC, empresa parceira deste Trabalho de Conclusão de Curso, sem contrato comercial com o projeto: ao clicar nos links, você passa a tratar diretamente com ela, sob as condições dela.",
    ],
  },
  {
    title: "7. Disponibilidade",
    body: [
      "Por ser um projeto acadêmico, o SafeID é oferecido como está, sem garantia de funcionamento contínuo. Ele pode ficar indisponível, mudar ou ser encerrado. Se for encerrado, os dados serão apagados, e avisaremos com antecedência sempre que possível.",
    ],
  },
  {
    title: "8. Responsabilidade",
    body: [
      "O SafeID informa sobre vazamentos que já aconteceram em outros serviços: não é responsável por esses vazamentos nem pelas consequências deles. Dentro do que a lei permite, também não responde por decisões tomadas apenas com base no score ou no plano de ação. Nada aqui limita os direitos garantidos a você pela legislação brasileira.",
    ],
  },
  {
    title: "9. Encerrar a conta",
    body: [
      "Você pode excluir sua conta a qualquer momento pelo botão \"Excluir conta\" no painel. O que acontece com os dados está na Política de Privacidade.",
    ],
  },
  {
    title: "10. Alterações e lei aplicável",
    body: [
      `Estes termos podem mudar: a nova versão será publicada nesta página e, se a mudança for relevante, avisaremos você. Valem as leis do Brasil. Última atualização: ${LEGAL.updatedAt}.`,
    ],
  },
];

export default function Terms({ onBack }) {
  return (
    <LegalDocument
      eyebrow="CONDIÇÕES DE USO"
      title="Termos de Uso"
      intro="Estes termos valem para o uso do SafeID. Ao criar uma conta ou entrar com o Google, você declara que os leu e concorda com eles e com a Política de Privacidade."
      sections={SECTIONS}
      onBack={onBack}
    />
  );
}
