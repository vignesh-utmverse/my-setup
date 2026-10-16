for i in 0 1 2 ; do 
	mkdir instance-$i ; 
	cockroach cert create-ca --certs-dir=instance-$i --ca-key=instance-${i}/ca.key ; 
	cockroach cert create-node 0.crdb.instance-${i}.test.com 1.crdb.instance-${i}.test.com 2.crdb.instance-${i}.test.com --certs-dir=instance-$i --ca-key=instance-${i}/ca.key ; 
	cockroach cert create-client root --certs-dir=instance-$i --ca-key=instance-${i}/ca.key ; 
done
