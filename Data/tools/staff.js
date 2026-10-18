const { User } = require("../JS/Database.js");

const userId = "1426952548102963410";

(async() => {
    const us = await User.findOne({ id: userId });
    console.log(us)

    us.staff = true;

    await us.save();

    console.log(`Staff ${userId}`);

    process.exit(0);
})();