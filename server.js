const express = require('express');
const cors = require('cors');// Angular (localhost:4200) and Express (localhost:3000) are different origins,
                            // so without this the browser blocks Angular's requests to this API by default.
                    // cors() adds the Access-Control-Allow-Origin header to responses so the browser allows it.

const app = express();

app.use(cors());            // allow requests from other origins (Angular on :4200)
app.use(express.json());    // parse JSON request bodies into req.body

app.get('/', (req, res) => {            // test route to confirm the server is alive
  res.send('Fabulari API running');
});

const fs = require('fs');
const path = require('path');

const usersPath = path.join(__dirname, 'data', 'users.json');       // location of the users data file



//register route
app.post('/register', (req, res) => {       // handles new user signups
  const { email, password } = req.body;     // pull fields out of the request body
  
    if (!email || !password) {    // reject the request early if either field is missing/empty
    return res.status(400).json({ error: 'Email and password are required' });      // 400 = Bad Request, it tells the client (Angular) it sent invalid input,
  }

  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));// read the users.json file as a string, then parse it into a real JS array so  can search it and push new users onto it below
                                                            
  const existingUser = users.find(user => user.email === email);        // check if email is already registered
    if (existingUser) {
        return res.status(409).json({error: 'Email is already registered'});        //
    }
    users.push({ email, password });
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    res.status(201).json({ message: 'User registered successfully' });
});

//login route
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });      // 400 = Bad Request, it tells the client (Angular) it sent invalid input,
    }
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8')); // read and parse the current users list, same as in /register

    const user = users.find(u => u.email === email); // look for a user whose email matches the one submitted; undefined if none found

        if (!user || user.password !== password) {
            return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.status(200).json({ message: 'Login successful', email: user.email });
});


const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

