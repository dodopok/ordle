-- O ranking mostra o primeiro nome por padrão. A primeira versão da tabela
-- nasceu com false antes de a opção existir na interface; a conversão abaixo
-- coloca as contas já criadas no novo padrão uma única vez. Depois disso, o
-- checkbox do perfil preserva qualquer escolha explícita.
alter table public.ordle_profiles
  alter column leaderboard_opt_in set default true;

update public.ordle_profiles
set leaderboard_opt_in = true
where leaderboard_opt_in = false;
