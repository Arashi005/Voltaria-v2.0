module.exports = {
    botName: process.env.BOT_NAME || 'Voltaria Nexus',

    prefix: process.env.PREFIX || '.',

    ownerNumber: process.env.OWNER_NUMBER
        ? process.env.OWNER_NUMBER.split(',')
        : [],

    mongodbUrl: process.env.MONGODB_URL || ''
};
