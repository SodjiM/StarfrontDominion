const db = require('../../db');

class SectorGenerationPipeline {
    constructor(sectorId, options = {}) {
        this.sectorId = sectorId;
        this.options = {
            archetypeKey: options.archetypeKey,
            seedBase: options.seedBase,
            createStartingObjects: options.createStartingObjects === true,
            player: options.player,
            gameId: options.gameId
        };
        const { ValidateSectorStep } = require('./pipeline-steps/validate-sector-step');
        const { SelectArchetypeStep } = require('./pipeline-steps/select-archetype-step');
        const { GenerateCelestialObjectsStep } = require('./pipeline-steps/generate-celestial-step');
        const { GenerateResourceNodesStep } = require('./pipeline-steps/generate-resources-step');
        const { CreateStartingObjectsStep } = require('./pipeline-steps/create-starting-objects-step');
        const { FinalValidateStep } = require('./pipeline-steps/final-validate-step');
        this.steps = [
            new ValidateSectorStep(),
            new SelectArchetypeStep(),
            new GenerateCelestialObjectsStep(),
            new GenerateResourceNodesStep(),
            new CreateStartingObjectsStep(),
            new FinalValidateStep()
        ];
        this.context = { sectorId };
        this.results = {};
        this.progress = { currentStep: null, completedSteps: [], totalSteps: this.steps.length };
    }

    async execute() {
        // Ensure database migrations/columns are ready before generation
        if (db && db.ready) {
            try { await db.ready; } catch {}
        }
        // Wrap generation in a transaction to avoid partial state
        await new Promise((resolve, reject) => db.run('BEGIN IMMEDIATE TRANSACTION', (e) => e ? reject(e) : resolve()));
        try {
            for (const step of this.steps) {
                this.progress.currentStep = step.name;
                await step.execute(this.context, this.options);
                this.results[step.name] = step.result;
                this.progress.completedSteps.push(step);
            }
            await new Promise((resolve, reject) => db.run('COMMIT', (e) => e ? reject(e) : resolve()));
            return { success: true, ...this.results };
        } catch (error) {
            try { await new Promise((resolve) => db.run('ROLLBACK', () => resolve())); } catch {}
            await this.rollback(error);
            throw error;
        }
    }

    async rollback(error) {
        // Best-effort per-step rollback in reverse order
        for (const step of this.progress.completedSteps.reverse()) {
            try { await step.rollback?.(this.context, error); } catch {}
        }
    }
}

module.exports = { SectorGenerationPipeline };


