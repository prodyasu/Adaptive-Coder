## Reproducible N=4 statistics

Problems: binary-search, climbing-stairs, container-with-most-water, coin-change-ii
Bootstrap: 10000 iterations, seed 20260521

### Pass@1

- raw_base: 2/4 = 0.500; exact 95% CI [0.0676, 0.9324]; bootstrap 95% CI [0.0000, 1.0000]; pass@2 0.833
- gen0_seed: 2/4 = 0.500; exact 95% CI [0.0676, 0.9324]; bootstrap 95% CI [0.0000, 1.0000]; pass@2 0.833
- gen18_evolved: 4/4 = 1.000; exact 95% CI [0.3976, 1.0000]; bootstrap 95% CI [1.0000, 1.0000]; pass@2 1.000

Paired exact comparisons, alternative = later pipeline greater:
- raw_base→gen0_seed: bWins=0, aWins=0, discordant=0, p = 1.0000
- raw_base→gen18_evolved: bWins=2, aWins=0, discordant=2, p = 0.2500
- gen0_seed→gen18_evolved: bWins=2, aWins=0, discordant=2, p = 0.2500

### Pass@N

- raw_base: 2/4 = 0.500; exact 95% CI [0.0676, 0.9324]; bootstrap 95% CI [0.0000, 1.0000]; pass@2 0.833
- gen0_seed: 4/4 = 1.000; exact 95% CI [0.3976, 1.0000]; bootstrap 95% CI [1.0000, 1.0000]; pass@2 1.000
- gen18_evolved: 4/4 = 1.000; exact 95% CI [0.3976, 1.0000]; bootstrap 95% CI [1.0000, 1.0000]; pass@2 1.000

Paired exact comparisons, alternative = later pipeline greater:
- raw_base→gen0_seed: bWins=2, aWins=0, discordant=2, p = 0.2500
- raw_base→gen18_evolved: bWins=2, aWins=0, discordant=2, p = 0.2500
- gen0_seed→gen18_evolved: bWins=0, aWins=0, discordant=0, p = 1.0000
