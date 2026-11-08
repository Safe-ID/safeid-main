# Entregas acadêmicas do SafeID

Documentos e apresentações entregues no Projeto Integrado de Extensão do IFSP — Campus São Paulo.

## PI-2 (agosto a novembro de 2026)

| Arquivo | O que é |
|---|---|
| [SafeID_Trabalho_Final.pdf](PI-2/SafeID_Trabalho_Final.pdf) | Trabalho escrito, versão final (04/11/2026) |
| [SafeID_Trabalho_Final.docx](PI-2/SafeID_Trabalho_Final.docx) | O mesmo trabalho em Word, para edição |
| [SafeID_Apresentacao_Final.html](PI-2/SafeID_Apresentacao_Final.html) | Apresentação final, em 13/11/2026 |
| [SafeID_Apresentacao_SEDCITEC.html](PI-2/SafeID_Apresentacao_SEDCITEC.html) | Apresentação da 18ª SEDCITEC (21/10/2026), mantida como foi apresentada |

O trabalho incorpora as correções do professor e os resultados da campanha de testes de 03/11/2026, cujos relatórios estão em [`docs/testes`](../testes/README.md).

A apresentação da SEDCITEC é anterior à revisão do trabalho (só as bibliotecas foram embutidas no arquivo; o conteúdo está como foi apresentado) e tem números que mudaram depois, por exemplo a rota de consulta e os limites de requisição. A apresentação final é a referência atual.

### Roteiro da apresentação final (20 minutos)

São 15 slides para a apresentação, na estrutura da PI-1 (problema, solução proposta, arquitetura, diagramas de implantação, segurança e viabilidade) e com a divisão de falas da SEDCITEC. Cerca de 18 min 45 s de fala, com folga para as trocas de apresentador.

| Slides | Quem fala | Conteúdo | Até |
|---|---|---|---|
| 1–3 | Kelvyn | Abertura, contexto e problema, solução proposta e mercado | 3:00 |
| 4–6 | Matheus | Objetivos, modelo de risco e cálculo ao vivo | 6:30 |
| 7 | João | Interface (novo visual) e tecnologias | 7:30 |
| 8–11 | Lucas | Arquitetura, diagramas de implantação (Figuras 15 e 16), segurança e LGPD, qualidade e validação | 13:00 |
| 12 | João | Demonstração ao vivo em produção | 16:00 |
| 13 | Matheus | Gestão e viabilidade | 17:15 |
| 14–15 | Kelvyn | Resultados, continuidade, conclusão e perguntas | 18:45 |

Depois da conclusão ficam 9 slides de reserva, fora da contagem, para perguntas da banca: regras de negócio, requisitos, modelo de dados, LGPD, AWS em detalhe, testes, campanha de 03/11, viabilidade com riscos e trabalhos futuros. O tempo de cada slide está nas notas do apresentador (tecla S).

### Como abrir as apresentações

São páginas HTML com Reveal.js. Basta abrir o arquivo no navegador: o Reveal.js e os ícones estão embutidos e funcionam sem internet. Só as fontes vêm do Google Fonts; sem internet, o navegador usa as fontes do sistema.

- **F**: tela cheia
- **S**: notas do apresentador, com quem fala e o tempo de cada slide
- **Setas**: avançar e voltar

Antes da apresentação, religue o NAT Gateway (ver o modo economia em [`docs/Backend/DEPLOY_PRODUCAO.md`](../Backend/DEPLOY_PRODUCAO.md)) para a demonstração ao vivo.

## PI-1 (março a junho de 2026)

| Arquivo | O que é |
|---|---|
| [safeid_projeto.pdf](PI-1/safeid_projeto.pdf) | Trabalho escrito da PI-1 |
| [safeid_projeto.docx](PI-1/safeid_projeto.docx) | O mesmo trabalho em Word |
| [SafeID_PoC.pptx](PI-1/SafeID_PoC.pptx) | Apresentação da prova de conceito |
| [SafeID_Apresentacao-1.pptx](PI-1/SafeID_Apresentacao-1.pptx) | Apresentação da PI-1 |
| [SafeID_Apresentacao_v2.pptx](PI-1/SafeID_Apresentacao_v2.pptx) | Apresentação da PI-1, segunda versão |
