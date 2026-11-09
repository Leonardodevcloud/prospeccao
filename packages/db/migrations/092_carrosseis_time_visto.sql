-- A apresentação do time de IA dos carrosséis aparece uma vez para cada pessoa (como o tour).
ALTER TABLE cadastro.usuarios ADD COLUMN time_carrosseis_visto_em timestamptz;
