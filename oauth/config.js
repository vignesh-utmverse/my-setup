module.exports = {
    PORT: 80,
    HOST: 'http://mock-oauth',

    JWT_EXPIRY: 1800, // 30 minutes
    JWT_ISSUER: 'http://mock-oauth',

    // Authorized Google service account emails
    AUTHORIZED_ACCOUNTS: [
        'utmverse-staging@utmverse-staging.iam.gserviceaccount.com',
    ],

    // Valid scopes this server can issue (enforcement is on the DSS side)
    SCOPES: [
        'utm.strategic_coordination',
        'utm.constraint_management',
        'utm.constraint_processing',
        'utm.conformance_monitoring_sa',
        'utm.availability_arbitration',
        'dss.read.identification_service_areas',
        'dss.write.identification_service_areas',
        'rid.display_provider',
        'rid.service_provider',
    ],

    // Per-account scope restrictions (email -> allowed scopes)
    ACCOUNT_SCOPES: {
        'utmverse-staging@utmverse-staging.iam.gserviceaccount.com': ['utm.availability_arbitration', 'utm.strategic_coordination' , 'dss.read.identification_service_areas' , 'dss.write.identification_service_areas' , 'rid.display_provider' , 'rid.service_provider'],
    },

    // Per-account subject name (email -> sub claim)
    ACCOUNT_SUBJECTS: {
        'utmverse-staging@utmverse-staging.iam.gserviceaccount.com': 'UTMverse',
    },

    DEFAULT_GSCOPE: 'email',
};
