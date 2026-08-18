-- CreateTable
CREATE TABLE "OrganizationInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationInvite_tokenHash_key" ON "OrganizationInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "OrganizationInvite_organizationId_email_idx" ON "OrganizationInvite"("organizationId", "email");

-- AddForeignKey
ALTER TABLE "OrganizationInvite" ADD CONSTRAINT "OrganizationInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
