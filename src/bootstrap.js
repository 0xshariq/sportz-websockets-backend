if (!process.env.VERCEL) {
  const { default: AgentAPI } = await import('apminsight');
  AgentAPI.config();
}

await import('./index.js');
