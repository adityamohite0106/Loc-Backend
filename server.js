const express = require('express');
const mysql = require('mysql2/promise'); // Use promise version
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config(); // Load environment variables

const app = express();

// Configure CORS to allow specific origin
app.use(cors({
  origin: 'https://loc-ivory.vercel.app/', // Allow only your frontend origin
  methods: ['GET', 'POST', 'OPTIONS'], // Allow specific methods
  allowedHeaders: ['Content-Type'], // Allow specific headers
  credentials: false // Set to true if you need to send cookies or auth headers
}));

app.use(bodyParser.json());

// Enable preflight for all routes
app.options('*', cors()); // Handle preflight OPTIONS requests for all routes


// Root route to handle GET /
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Loan Application API' });
});

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'loan_db',
  port: process.env.DB_PORT || 3306
};





// Create connection pool for better performance
const pool = mysql.createPool(dbConfig);

// ✅ Test connection after pool is created
(async () => {
  try {
    const connection = await pool.getConnection();
    await connection.query('SELECT 1'); // simple test query
    connection.release();
    console.log('✅ Database connection successful!');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
  }
})();


app.post('/api/submit-loan', async (req, res) => {
  const formData = req.body;

  // Validate required fields
  if (!formData.newApplication?.custNo || !formData.newApplication?.custName || !formData.newApplication?.appNo) {
    return res.status(400).json({ error: 'Missing required fields in newApplication' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Helper function to convert undefined to null
    const sanitizeValue = (value) => (value === undefined ? null : value);

    // 1️⃣ Insert newApplication
    const newApp = formData.newApplication || {};
    const newAppQuery = `
      INSERT INTO new_application 
      (branch, cust_no, cust_name, application_sale_date, app_no, branch_inward_no, branch_inward_date,
       type_of_loan, amount_of_loan, period_of_repayment, security, collateral_security, purpose_of_loan,
       loan_board_resolution_no, loan_board_date, director_board_resolution_no, director_board_date,
       loan_form_submitted_date_branch, loan_form_submitted_date_head, officer_board_resolution_no)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const newAppValues = [
      sanitizeValue(newApp.branch),
      sanitizeValue(newApp.custNo),
      sanitizeValue(newApp.custName),
      sanitizeValue(newApp.applicationSaleDate),
      sanitizeValue(newApp.appNo),
      sanitizeValue(newApp.branchInwardNo),
      sanitizeValue(newApp.branchInwardDate),
      sanitizeValue(newApp.typeOfLoan),
      parseFloat(sanitizeValue(newApp.amountOfLoan)) || 0,
      parseInt(sanitizeValue(newApp.periodOfRepayment)) || 0,
      sanitizeValue(newApp.security),
      sanitizeValue(newApp.collateralSecurity),
      sanitizeValue(newApp.purposeOfLoan),
      sanitizeValue(newApp.loanBoardResolutionNo),
      sanitizeValue(newApp.loanBoardDate),
      sanitizeValue(newApp.directorBoardResolutionNo),
      sanitizeValue(newApp.directorBoardDate),
      sanitizeValue(newApp.loanFormSubmittedDateBranch),
      sanitizeValue(newApp.loanFormSubmittedDateHead),
      sanitizeValue(newApp.officerBoardResolutionNo)
    ];

    const [newAppResult] = await connection.execute(newAppQuery, newAppValues);
    const application_id = newAppResult.insertId;

    // 2️⃣ Insert customerDetails
    const cust = formData.customerDetails || {};
    if (Object.keys(cust).length > 0) {
      const custQuery = `
        INSERT INTO customer_details
        (application_id, dob, contact_no, email, address, city, state, pin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const custValues = [
        application_id,
        sanitizeValue(cust.dob),
        sanitizeValue(cust.mobile || cust.contactNo),
        sanitizeValue(cust.email),
        sanitizeValue(cust.address),
        sanitizeValue(cust.city),
        sanitizeValue(cust.state),
        sanitizeValue(cust.pin)
      ];

      const [custResult] = await connection.execute(custQuery, custValues);
      const customer_id = custResult.insertId;

      // 3️⃣ Insert bankDetails
      const bank = formData.bankDetails?.accounts?.[0] || {};
      if (Object.keys(bank).length > 0) {
        const bankQuery = `
          INSERT INTO bank_details (customer_id, bank_name, branch_name, account_no, ifsc_code, account_type)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        const bankValues = [
          customer_id,
          sanitizeValue(bank.bankName),
          sanitizeValue(bank.branch),
          sanitizeValue(bank.accountNo),
          sanitizeValue(bank.ifscCode),
          sanitizeValue(bank.type || bank.accountType)
        ];
        await connection.execute(bankQuery, bankValues);
      }

      // 4️⃣ Insert propertyFirm
      const property = formData.propertyFirm || {};
      let property_id = null;
      if (Object.keys(property).length > 0) {
        const propertyQuery = `
          INSERT INTO property_firm (customer_id, personal_assets_owned, personal_assets_mortgaged, other_assets_shares)
          VALUES (?, ?, ?, ?)
        `;
        const propertyValues = [
          customer_id,
          sanitizeValue(property.personalAssetsOwned),
          sanitizeValue(property.personalAssetsMortgaged),
          sanitizeValue(property.otherAssetsShares)
        ];
        const [propertyResult] = await connection.execute(propertyQuery, propertyValues);
        property_id = propertyResult.insertId;

        // 4a. Insert firmDetails
        if (property.firmDetails && Array.isArray(property.firmDetails)) {
          for (const firm of property.firmDetails) {
            const firmQuery = `
              INSERT INTO firm_details (property_id, name, business, relation, bank_name)
              VALUES (?, ?, ?, ?, ?)
            `;
            const firmValues = [
              property_id,
              sanitizeValue(firm.name),
              sanitizeValue(firm.business),
              sanitizeValue(firm.relation),
              sanitizeValue(firm.bankName)
            ];
            await connection.execute(firmQuery, firmValues);
          }
        }
      }

      // 5️⃣ Insert policy_details
      if (formData.policyDetails?.policies && Array.isArray(formData.policyDetails.policies)) {
        for (const policy of formData.policyDetails.policies) {
          const policyQuery = `
            INSERT INTO policy_details (customer_id, company_name, policy_no, period, total_paid)
            VALUES (?, ?, ?, ?, ?)
          `;
          const policyValues = [
            customer_id,
            sanitizeValue(policy.companyName),
            sanitizeValue(policy.policyNo),
            sanitizeValue(policy.period),
            parseFloat(sanitizeValue(policy.totalPaid)) || 0
          ];
          await connection.execute(policyQuery, policyValues);
        }
      }

      // 6️⃣ Insert guarantor_details
      if (formData.guarantorDetails?.guarantors && Array.isArray(formData.guarantorDetails.guarantors)) {
        for (const guar of formData.guarantorDetails.guarantors) {
          const guarQuery = `
            INSERT INTO guarantor_details (customer_id, branch, name, amount, institute)
            VALUES (?, ?, ?, ?, ?)
          `;
          const guarantorValues = [
            customer_id,
            sanitizeValue(guar.branch),
            sanitizeValue(guar.name || guar.whom),
            parseFloat(sanitizeValue(guar.amount)) || 0,
            sanitizeValue(guar.institute)
          ];
          await connection.execute(guarQuery, guarantorValues);
        }
      }

      // 7️⃣ Insert directors_partners
      if (formData.directorPartner?.rows && Array.isArray(formData.directorPartner.rows)) {
        for (const dir of formData.directorPartner.rows) {
          const dirQuery = `
            INSERT INTO directors_partners (customer_id, type, name, dob, share, qualification)
            VALUES (?, ?, ?, ?, ?, ?)
          `;
          const dirValues = [
            customer_id,
            sanitizeValue(formData.directorPartner.type),
            sanitizeValue(dir.name),
            sanitizeValue(dir.dob),
            parseFloat(sanitizeValue(dir.share)) || 0,
            sanitizeValue(dir.qualification)
          ];
          await connection.execute(dirQuery, dirValues);
        }
      }

      // 8️⃣ Insert income_returns
      if (formData.incomeReturns?.itReturns && Array.isArray(formData.incomeReturns.itReturns)) {
        for (const it of formData.incomeReturns.itReturns) {
          const itQuery = `
            INSERT INTO income_returns (customer_id, accounting_year, ay_year, taxable_income)
            VALUES (?, ?, ?, ?)
          `;
          const itValues = [
            customer_id,
            sanitizeValue(it.accountingYear),
            sanitizeValue(it.ayYear),
            parseFloat(sanitizeValue(it.taxableIncome)) || 0
          ];
          await connection.execute(itQuery, itValues);
        }
      }

      // Insert purchase_sales
      if (formData.incomeReturns?.purchaseSale3Years && Array.isArray(formData.incomeReturns.purchaseSale3Years)) {
        for (const ps of formData.incomeReturns.purchaseSale3Years) {
          const psQuery = `
            INSERT INTO purchase_sales (customer_id, financial_year, purchase_rs, sales_rs)
            VALUES (?, ?, ?, ?)
          `;
          const psValues = [
            customer_id,
            sanitizeValue(ps.financialYear),
            parseFloat(sanitizeValue(ps.purchaseRs)) || 0,
            parseFloat(sanitizeValue(ps.salesRs)) || 0
          ];
          await connection.execute(psQuery, psValues);
        }
      }

      // 9️⃣ Insert shares_add
      const shares = formData.sharesAdd || {};
      if (Object.keys(shares).length > 0) {
        const sharesQuery = `
          INSERT INTO shares_add
          (customer_id, application_type, member_ref_no, application_no, no_of_shares, share_value, saving_acc_no, total_amount, remark, payment_mode)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const sharesValues = [
          customer_id,
          sanitizeValue(shares.applicationType),
          sanitizeValue(shares.memberRefNo),
          sanitizeValue(shares.applicationNo),
          parseInt(sanitizeValue(shares.noOfShares)) || 0,
          parseFloat(sanitizeValue(shares.shareValue)) || 0,
          sanitizeValue(shares.savingAccNo),
          parseFloat(sanitizeValue(shares.totalAmount)) || 0,
          sanitizeValue(shares.remark),
          sanitizeValue(shares.paymentMode)
        ];
        await connection.execute(sharesQuery, sharesValues);
      }
    }

    // ✅ Commit transaction
    await connection.commit();
    res.json({ message: 'Application submitted successfully', application_id });

  } catch (error) {
    // ❌ Rollback transaction on error
    await connection.rollback();
    console.error('Transaction error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sql: error.sql,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({ error: 'Failed to submit application', details: error.message });
  } finally {
    // Always release the connection
    connection.release();
  }
});

// Test endpoint to verify database connection
app.get('/api/test', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT 1 as test');
    connection.release();
    res.json({ message: 'Database connection successful', data: rows });
  } catch (error) {
    console.error('Database test failed:', error);
    res.status(500).json({ error: 'Database connection failed', details: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(process.env.PORT || 5000, () => console.log(`Server running on http://localhost:${process.env.PORT || 5000}`));