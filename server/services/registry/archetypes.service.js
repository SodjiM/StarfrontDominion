const { SECTOR_ARCHETYPES } = require('./archetypes');

class ArchetypesService {
    listArchetypes() {
        return Object.values(SECTOR_ARCHETYPES || {});
    }
}

module.exports = { ArchetypesService };


