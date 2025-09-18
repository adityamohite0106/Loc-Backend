const express = require('express');
const mysql = require('mysql2/promise'); // Use promise version
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config(); // Load environment variables

const app = express();
app.use(bodyParser.json());
app.use(cors());

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

    // 1️⃣ Insert newApplication
    const newApp = formData.newApplication;
    const newAppQuery = `
      INSERT INTO new_application 
      (branch, cust_no, cust_name, application_sale_date, app_no, branch_inward_no, branch_inward_date,
       type_of_loan, amount_of_loan, period_of_repayment, security, collateral_security, purpose_of_loan,
       loan_board_resolution_no, loan_board_date, director_board_resolution_no, director_board_date,
       loan_form_submitted_date_branch, loan_form_submitted_date_head, officer_board_resolution_no)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const newAppValues = [
      newApp.branch, newApp.custNo, newApp.custName, newApp.applicationSaleDate, newApp.appNo,
      newApp.branchInwardNo, newApp.branchInwardDate, newApp.typeOfLoan, parseFloat(newApp.amountOfLoan || 0),
      parseInt(newApp.periodOfRepayment || 0), newApp.security, newApp.collateralSecurity, newApp.purposeOfLoan,
      newApp.loanBoardResolutionNo, newApp.loanBoardDate, newApp.directorBoardResolutionNo, newApp.directorBoardDate,
      newApp.loanFormSubmittedDateBranch, newApp.loanFormSubmittedDateHead, newApp.officerBoardResolutionNo
    ];

    const [newAppResult] = await connection.execute(newAppQuery, newAppValues);
    const application_id = newAppResult.insertId;

    // 2️⃣ Insert customerDetails (Updated to match your schema)
    const cust = formData.customerDetails;
    if (cust) {
      const custQuery = `
        INSERT INTO customer_details
        (application_id, dob, contact_no, email, address, city, state, pin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const custValues = [
        application_id, 
        cust.dob, 
        cust.mobile || cust.contactNo, 
        cust.email, 
        cust.address, 
        cust.city, 
        cust.state, 
        cust.pin
      ];

      const [custResult] = await connection.execute(custQuery, custValues);
      const customer_id = custResult.insertId;

      // 3️⃣ Insert bankDetails (Updated to match your schema)
      const bank = formData.bankDetails?.accounts?.[0];
      if (bank) {
        const bankQuery = `
          INSERT INTO bank_details (customer_id, bank_name, branch_name, account_no, ifsc_code, account_type)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        const bankValues = [
          customer_id, 
          bank.bankName, 
          bank.branch, 
          bank.accountNo, 
          bank.ifscCode, 
          bank.type || bank.accountType
        ];
        await connection.execute(bankQuery, bankValues);
      }

      // 4️⃣ Insert propertyFirm (Updated to match your schema)
      const property = formData.propertyFirm;
      let property_id = null;
      if (property) {
        const propertyQuery = `
          INSERT INTO property_firm (customer_id, personal_assets_owned, personal_assets_mortgaged, other_assets_shares)
          VALUES (?, ?, ?, ?)
        `;
        const propertyValues = [
          customer_id, 
          property.personalAssetsOwned, 
          property.personalAssetsMortgaged, 
          property.otherAssetsShares
        ];
        const [propertyResult] = await connection.execute(propertyQuery, propertyValues);
        property_id = propertyResult.insertId;

        // 4a. Insert firmDetails (Schema matches)
        if (property.firmDetails && Array.isArray(property.firmDetails)) {
          for (const firm of property.firmDetails) {
            const firmQuery = `
              INSERT INTO firm_details (property_id, name, business, relation, bank_name)
              VALUES (?, ?, ?, ?, ?)
            `;
            const firmValues = [property_id, firm.name, firm.business, firm.relation, firm.bankName];
            await connection.execute(firmQuery, firmValues);
          }
        }
      }

      // 5️⃣ Insert policy_details (Updated table name and schema)
      if (formData.policyDetails?.policies && Array.isArray(formData.policyDetails.policies)) {
        for (const policy of formData.policyDetails.policies) {
          const policyQuery = `
            INSERT INTO policy_details (customer_id, company_name, policy_no, period, total_paid)
            VALUES (?, ?, ?, ?, ?)
          `;
          const policyValues = [
            customer_id, 
            policy.companyName, 
            policy.policyNo, 
            policy.period, 
            parseFloat(policy.totalPaid || 0)
          ];
          await connection.execute(policyQuery, policyValues);
        }
      }

      // 6️⃣ Insert guarantor_details (Updated table name and schema)
      if (formData.guarantorDetails?.guarantors && Array.isArray(formData.guarantorDetails.guarantors)) {
        for (const guar of formData.guarantorDetails.guarantors) {
          const guarQuery = `
            INSERT INTO guarantor_details (customer_id, branch, name, amount, institute)
            VALUES (?, ?, ?, ?, ?)
          `;
          const guarValues = [
            customer_id, 
            guar.branch, 
            guar.name || guar.whom, 
            parseFloat(guar.amount || 0), 
            guar.institute
          ];
          await connection.execute(guarQuery, guarValues);
        }
      }

      // 7️⃣ Insert directors_partners (Schema matches)
      if (formData.directorPartner?.rows && Array.isArray(formData.directorPartner.rows)) {
        for (const dir of formData.directorPartner.rows) {
          const dirQuery = `
            INSERT INTO directors_partners (customer_id, type, name, dob, share, qualification)
            VALUES (?, ?, ?, ?, ?, ?)
          `;
          const dirValues = [
            customer_id, 
            formData.directorPartner.type, 
            dir.name, 
            dir.dob, 
            parseFloat(dir.share || 0), 
            dir.qualification
          ];
          await connection.execute(dirQuery, dirValues);
        }
      }

      // 8️⃣ Insert income_returns (Schema matches)
      if (formData.incomeReturns?.itReturns && Array.isArray(formData.incomeReturns.itReturns)) {
        for (const it of formData.incomeReturns.itReturns) {
          const itQuery = `
            INSERT INTO income_returns (customer_id, accounting_year, ay_year, taxable_income)
            VALUES (?, ?, ?, ?)
          `;
          const itValues = [
            customer_id, 
            it.accountingYear, 
            it.ayYear, 
            parseFloat(it.taxableIncome || 0)
          ];
          await connection.execute(itQuery, itValues);
        }
      }

      // Insert purchase_sales (Schema matches)
      if (formData.incomeReturns?.purchaseSale3Years && Array.isArray(formData.incomeReturns.purchaseSale3Years)) {
        for (const ps of formData.incomeReturns.purchaseSale3Years) {
          const psQuery = `
            INSERT INTO purchase_sales (customer_id, financial_year, purchase_rs, sales_rs)
            VALUES (?, ?, ?, ?)
          `;
          const psValues = [
            customer_id, 
            ps.financialYear, 
            parseFloat(ps.purchaseRs || 0), 
            parseFloat(ps.salesRs || 0)
          ];
          await connection.execute(psQuery, psValues);
        }
      }

      // 9️⃣ Insert shares_add (Schema matches)
      const shares = formData.sharesAdd;
      if (shares) {
        const sharesQuery = `
          INSERT INTO shares_add
          (customer_id, application_type, member_ref_no, application_no, no_of_shares, share_value, saving_acc_no, total_amount, remark, payment_mode)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const sharesValues = [
          customer_id,
          shares.applicationType,
          shares.memberRefNo,
          shares.applicationNo,
          parseInt(shares.noOfShares || 0),
          parseFloat(shares.shareValue || 0),
          shares.savingAccNo,
          parseFloat(shares.totalAmount || 0),
          shares.remark,
          shares.paymentMode
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
      sql: error.sql
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