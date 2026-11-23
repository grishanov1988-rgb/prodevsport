-- ============================================================
--  0002: FC26-карточки — характеристики игроков
--  Шесть статов полевых (PAC/SHO/PAS/DRI/DEF/PHY) в общих колонках;
--  у вратарей (is_gk=true) в тех же колонках хранятся DIV/HAN/KIC/REF/SPD/POS.
--  Применено к проекту wtiiokkgemyozclnallj 2026-11-24.
-- ============================================================

alter table cards_catalog add column if not exists pac smallint;
alter table cards_catalog add column if not exists sho smallint;
alter table cards_catalog add column if not exists pas smallint;
alter table cards_catalog add column if not exists dri smallint;
alter table cards_catalog add column if not exists def smallint;
alter table cards_catalog add column if not exists phy smallint;
alter table cards_catalog add column if not exists is_gk boolean not null default false;

-- Данные (состав «Арсенал» FC26, 28 карточек) записаны напрямую в БД;
-- выгрузка: select * from cards_catalog where club='Арсенал' order by ovr desc;
