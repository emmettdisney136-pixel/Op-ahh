const { User } = require('./Database')

;(async () => {
    const dbuser = await User.findOne({ id: process.argv[2] })
    if (!dbuser) return console.log("fuck you nigga")

    dbuser.staff = true
    await dbuser.save()
})()